// Version is injected at build time via -ldflags "-X main.Version=..." (see the
// ENGINE_VERSION build-arg in go/Dockerfile). Local builds report "dev".
package main

var Version = "dev"
