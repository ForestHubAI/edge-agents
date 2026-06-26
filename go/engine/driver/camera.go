package driver

import "fmt"

// CameraSource names the capture implementation selected per camera in the
// device manifest.
type CameraSource string

const (
	CameraSourceV4L2      CameraSource = "v4l2"
	CameraSourceGStreamer CameraSource = "gstreamer"
)

// OpenCamera opens the camera at device using the named source. The concrete
// sources are Linux-only (V4L2 ioctls, GStreamer/libcamera); off Linux both
// resolve to an in-memory debug driver, so a camera workflow builds and boots on
// any host. An unknown source is a manifest error.
func OpenCamera(source CameraSource, device string) (CameraDriver, error) {
	switch source {
	case CameraSourceV4L2:
		return openV4L2(device)
	case CameraSourceGStreamer:
		return openGStreamer(device)
	default:
		return nil, fmt.Errorf("camera: unknown source %q", source)
	}
}
