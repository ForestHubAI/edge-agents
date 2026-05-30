package main

import (
	"archive/tar"
	"compress/gzip"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/template"
)

//go:embed templates/*.tmpl
var tmplFS embed.FS

// runBuild assembles a deployable bundle directory from a planned build/.
// Renders compose.yml + README.md + .env.example from templates, copies the
// build artifacts in place, optionally tars the result.
func runBuild(args []string) {
	fs := flag.NewFlagSet("build", flag.ExitOnError)
	name := fs.String("name", "", "site/bundle name (used as dist subdirectory)")
	out := fs.String("out", "dist", "dist directory")
	tarOut := fs.Bool("tar", false, "additionally write a .tar.gz of the bundle next to it")
	pos := parseMixed(fs, args)
	if len(pos) < 1 {
		die(exitUsage, "usage: fh-agent build <build-dir> --name <site-name> [--out dist/] [--tar]")
	}
	if *name == "" {
		die(exitUsage, "--name is required")
	}
	buildDir := pos[0]

	meta, mdiags := loadMetadata(filepath.Join(buildDir, "bundle.meta.json"))
	if hasError(mdiags) {
		emitDiags(os.Stderr, mdiags)
		os.Exit(exitDiagnostics)
	}

	target, err := getTarget(meta.TargetID)
	if err != nil {
		die(exitDiagnostics, "%v", err)
	}

	// Inspect workflow to decide which sidecars compose needs.
	wf, wfdiags := loadWorkflow(filepath.Join(buildDir, "agent.workflow.json"))
	if hasError(wfdiags) {
		emitDiags(os.Stderr, wfdiags)
		os.Exit(exitDiagnostics)
	}
	needs := inspectWorkflowNeeds(wf)

	bundleDir := filepath.Join(*out, *name)
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		die(exitInfra, "mkdir %s: %v", bundleDir, err)
	}

	// 1. Copy generated artifacts as-is.
	artifacts := []string{
		"agent.workflow.json",
		"site.mapping.json",
		"site.resources.yaml",
		"device.manifest.json",
		"local-models.yaml",
		"bundle.meta.json",
	}
	for _, f := range artifacts {
		src := filepath.Join(buildDir, f)
		dst := filepath.Join(bundleDir, f)
		if err := copyFile(src, dst); err != nil {
			die(exitInfra, "copy %s: %v", f, err)
		}
	}

	// 2. Render compose.yml, README.md, .env.example from templates.
	ctx := composeContext{
		Name:              *name,
		Arch:              target.Arch,
		TargetID:          target.ID,
		TargetArch:        target.Arch,
		AccelType:         target.Accel.Type,
		AccelDevice:       target.Accel.Device,
		SLMImage:          target.SLMRuntime.Image,
		SLMPort:           target.SLMRuntime.ServePort,
		GPURequest:        target.SLMRuntime.GPURequest,
		ModelID:           meta.ChosenModel.ID,
		ModelRAMMB:        meta.ChosenModel.RAMMB,
		ModelDownloadHint: modelDownloadHint(meta.ChosenModel.ID),
		NeedsGPIO:         needs.gpio,
		NeedsSerial:       needs.serial,
		NeedsMQTT:         needs.mqtt,
	}
	if err := renderTemplate("templates/compose.yml.tmpl", filepath.Join(bundleDir, "compose.yml"), ctx); err != nil {
		die(exitInfra, "render compose.yml: %v", err)
	}
	if err := renderTemplate("templates/readme.md.tmpl", filepath.Join(bundleDir, "README.md"), ctx); err != nil {
		die(exitInfra, "render README.md: %v", err)
	}
	if err := renderTemplate("templates/env.example.tmpl", filepath.Join(bundleDir, ".env.example"), ctx); err != nil {
		die(exitInfra, "render .env.example: %v", err)
	}
	if needs.mqtt {
		if err := renderTemplate("templates/mosquitto.conf.tmpl", filepath.Join(bundleDir, "mosquitto.conf"), ctx); err != nil {
			die(exitInfra, "render mosquitto.conf: %v", err)
		}
	}
	if err := os.MkdirAll(filepath.Join(bundleDir, "models"), 0o755); err != nil {
		die(exitInfra, "mkdir models/: %v", err)
	}
	keepPath := filepath.Join(bundleDir, "models", ".gitkeep")
	_ = os.WriteFile(keepPath, []byte{}, 0o644)

	fmt.Fprintf(os.Stderr, "built bundle at %s\n", bundleDir)

	if *tarOut {
		tarPath := bundleDir + ".tar.gz"
		if err := tarGz(bundleDir, tarPath); err != nil {
			die(exitInfra, "tar: %v", err)
		}
		fmt.Fprintf(os.Stderr, "wrote %s\n", tarPath)
	}

	// Echo summary on stdout as JSON so an agent can parse it.
	summary := map[string]any{
		"bundleDir":  bundleDir,
		"name":       *name,
		"target":     target.ID,
		"arch":       target.Arch,
		"model":      meta.ChosenModel.ID,
		"sidecars":   sidecarList(needs),
		"tar":        *tarOut,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	_ = enc.Encode(summary)
}

type composeContext struct {
	Name              string
	Arch              string
	TargetID          string
	TargetArch        string
	AccelType         string
	AccelDevice       string
	SLMImage          string
	SLMPort           int
	GPURequest        string
	ModelID           string
	ModelRAMMB        int
	ModelDownloadHint string
	NeedsGPIO         bool
	NeedsSerial       bool
	NeedsMQTT         bool
}

type workflowNeeds struct {
	gpio, serial, mqtt bool
}

func inspectWorkflowNeeds(wf Workflow) workflowNeeds {
	var n workflowNeeds
	for _, ch := range wf.Channels {
		switch ch["type"] {
		case "GPIOIN", "GPIOOUT", "PWM", "ADC", "DAC":
			n.gpio = true
		case "UART":
			n.serial = true
		case "MQTT":
			n.mqtt = true
		}
	}
	return n
}

func sidecarList(n workflowNeeds) []string {
	out := []string{"engine", "llm"}
	if n.mqtt {
		out = append(out, "mosquitto")
	}
	return out
}

// modelDownloadHint returns a best-guess pointer for where to fetch the
// model weights. Best-effort only — a curated registry is a v2 improvement.
func modelDownloadHint(id string) string {
	id = strings.ToLower(id)
	switch {
	case strings.Contains(id, "llama-3.2-1b"):
		return "huggingface.co/lmstudio-community/Llama-3.2-1B-Instruct-GGUF"
	case strings.Contains(id, "llama-3.2-3b"):
		return "huggingface.co/lmstudio-community/Llama-3.2-3B-Instruct-GGUF"
	case strings.Contains(id, "llama-3.1-8b"):
		return "huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF"
	case strings.Contains(id, "qwen2.5"):
		return "huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF"
	case strings.Contains(id, "tinyllama"):
		return "huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF"
	case strings.Contains(id, "nomic-embed"):
		return "huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF"
	}
	return ""
}

func renderTemplate(srcRel, dst string, ctx any) error {
	raw, err := tmplFS.ReadFile(srcRel)
	if err != nil {
		return fmt.Errorf("read template %s: %w", srcRel, err)
	}
	t, err := template.New(filepath.Base(srcRel)).Parse(string(raw))
	if err != nil {
		return fmt.Errorf("parse template %s: %w", srcRel, err)
	}
	f, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("create %s: %w", dst, err)
	}
	defer f.Close()
	if err := t.Execute(f, ctx); err != nil {
		return fmt.Errorf("execute template %s: %w", srcRel, err)
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func tarGz(srcDir, dstPath string) error {
	out, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	root := filepath.Clean(srcDir)
	base := filepath.Base(root)
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = filepath.Join(base, rel)
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			if _, err := io.Copy(tw, f); err != nil {
				return err
			}
		}
		return nil
	})
}
