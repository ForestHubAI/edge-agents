package driver

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/ForestHubAI/fh-core/go/logging"

	"github.com/rs/zerolog"
	"go.bug.st/serial"
)

// Compile-time assertion: genericSerial implements SerialDriver.
var _ SerialDriver = (*genericSerial)(nil)

// Max bytes buffered while waiting for a newline.
const maxLineBytes = 64 * 1024

// genericSerial is a cross-platform SerialDriver backed by go.bug.st/serial.
// One instance owns one open port and one reader goroutine; the reader
// implements the stealing contract — an in-flight Read takes a line
// before the permanent onLine callback registered via WatchRead.
type genericSerial struct {
	log    zerolog.Logger
	port   string
	baud   int
	handle serial.Port

	mu       sync.Mutex
	closed   bool
	done     chan struct{}
	onLine   func(string)
	waiter   chan string
	drainBuf bool
}

// OpenSerial opens the named port (8N1, 115200 if baud=0) and starts the
// reader goroutine.
func OpenSerial(port string, baud int) (SerialDriver, error) {
	if port == "" {
		return nil, fmt.Errorf("serial: port is required")
	}
	if baud == 0 {
		baud = 115200
	}
	mode := &serial.Mode{
		BaudRate: baud,
		DataBits: 8,
		Parity:   serial.NoParity,
		StopBits: serial.OneStopBit,
	}
	handle, err := serial.Open(port, mode)
	if err != nil {
		return nil, fmt.Errorf("open serial %s: %w", port, err)
	}
	// Disable the default 500ms read timeout so Read blocks until a line arrives or the port is closed
	if err := handle.SetReadTimeout(serial.NoTimeout); err != nil {
		handle.Close()
		return nil, fmt.Errorf("disable read timeout on %s: %w", port, err)
	}
	d := &genericSerial{
		port:   port,
		baud:   baud,
		handle: handle,
		done:   make(chan struct{}),
		log: logging.Logger.With().
			Str("driver", "serial").
			Str("port", port).
			Int("baud", baud).
			Logger(),
	}
	go d.readerLoop()
	d.log.Info().Msg("opened port")
	return d, nil
}

// Close releases the port; closing the handle unblocks the reader's
// kernel read so the goroutine exits. Idempotent.
func (d *genericSerial) Close() error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil
	}
	d.closed = true
	close(d.done)
	handle := d.handle
	d.mu.Unlock()

	if err := handle.Close(); err != nil {
		return fmt.Errorf("close serial %s: %w", d.port, err)
	}
	d.log.Info().Msg("closed port")
	return nil
}

// Read blocks until one line arrives, claiming the single waiter slot
// for the duration. Errors if another Read is already in flight.
func (d *genericSerial) Read(ctx context.Context) (string, error) {
	ch := make(chan string, 1)
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return "", fmt.Errorf("serial %s: closed", d.port)
	}
	if d.waiter != nil {
		d.mu.Unlock()
		return "", fmt.Errorf("serial %s: another Read is already in flight", d.port)
	}
	d.waiter = ch
	d.mu.Unlock()
	defer d.clearWaiter(ch)

	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-d.done:
		return "", fmt.Errorf("serial %s: closed", d.port)
	case line := <-ch:
		return line, nil
	}
}

// WatchRead installs onLine as the permanent line callback, replacing
// any prior callback.
func (d *genericSerial) WatchRead(onLine func(string)) error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return fmt.Errorf("serial %s: closed", d.port)
	}
	d.onLine = onLine
	d.mu.Unlock()
	return nil
}

// Write sends raw bytes; the caller is responsible for terminators.
func (d *genericSerial) Write(data string) error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return fmt.Errorf("serial %s: closed", d.port)
	}
	handle := d.handle
	d.mu.Unlock()

	if _, err := handle.Write([]byte(data)); err != nil {
		return fmt.Errorf("write serial %s: %w", d.port, err)
	}
	return nil
}

// Flush discards buffered input — kernel buffer plus any partial line
// in the reader. Lines already dispatched are unaffected.
func (d *genericSerial) Flush() error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return fmt.Errorf("serial %s: closed", d.port)
	}
	d.drainBuf = true
	handle := d.handle
	d.mu.Unlock()

	if err := handle.ResetInputBuffer(); err != nil {
		return fmt.Errorf("flush serial %s: %w", d.port, err)
	}
	return nil
}

// readerLoop pulls bytes, splits on '\n' (stripping trailing '\r'), and
// dispatches each line. Exits when handle.Read errors.
func (d *genericSerial) readerLoop() {
	tmp := make([]byte, 4096)
	var buf []byte
	for {
		d.mu.Lock()
		if d.drainBuf {
			buf = nil
			d.drainBuf = false
		}
		d.mu.Unlock()

		n, err := d.handle.Read(tmp)
		if err != nil {
			d.log.Warn().Err(err).Msg("reader exiting")
			return
		}
		if n == 0 {
			continue
		}
		buf = append(buf, tmp[:n]...)
		for {
			i := bytes.IndexByte(buf, '\n')
			if i < 0 {
				break
			}
			line := strings.TrimSuffix(string(buf[:i]), "\r")
			buf = buf[i+1:]
			d.dispatch(line)
		}
		if len(buf) > maxLineBytes {
			d.log.Warn().Int("bytes", len(buf)).Msg("line buffer overflow, dropping")
			buf = nil
		}
	}
}

// dispatch delivers one line — to the in-flight Read if any, otherwise
// to onLine.
func (d *genericSerial) dispatch(line string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.waiter != nil {
		d.waiter <- line
		d.waiter = nil
		return
	}
	if d.onLine != nil {
		d.onLine(line)
	}
}

func (d *genericSerial) clearWaiter(ch chan string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.waiter == ch {
		d.waiter = nil
	}
}
