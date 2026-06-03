package httpclient

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
)

// FormPart is the common interface for all form parts
type FormPart interface {
	// Write adds the part to the multipart.Writer
	WriteTo(writer *multipart.Writer) error
}

// Field represents a simple field form part
type Field struct {
	Name  string
	Value any
}

// WriteTo writes the field to the multipart.Writer
func (f *Field) WriteTo(writer *multipart.Writer) error {
	var str string
	switch v := f.Value.(type) {
	case string, int, int64, float64, bool:
		str = fmt.Sprintf("%v", v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		str = string(b)
	}
	return writer.WriteField(f.Name, str)
}

// File represents a file form part
type File struct {
	Name     string
	FileName string
	Reader   io.Reader
}

// WriteTo writes the file to the multipart.Writer
func (f *File) WriteTo(writer *multipart.Writer) error {
	part, err := writer.CreateFormFile(f.Name, f.FileName)
	if err != nil {
		return err
	}
	_, err = io.Copy(part, f.Reader)
	return err
}
