package llmproxy

// Input represents runtime input to a model. It can be either a string or an InputItem list.
type Input interface {
	// isInput is a marker method that seals the interface.
	isInput()
}

// InputString represents a simple string input. Can be used directly or as an item in InputItems.
type InputString string

func (InputString) isInput()         {}
func (InputString) isInputItem()     {}
func (s InputString) String() string { return string(s) }

// InputItems represents a list of InputItem.
type InputItems []InputItem

func (InputItems) isInput() {}

// InputItem represents a single item in InputItems.
type InputItem interface {
	// String returns a human-readable representation of the item, including its type.
	// This is used to serialize the item as plain text if the model only supports a single message type.
	String() string

	// isInputItem is a marker method that seals the interface.
	isInputItem()
}

// AsInputItems converts an Input to InputItems.
func AsInputItems(input Input) InputItems {
	if inpStr, ok := input.(InputString); ok {
		return InputItems{inpStr}
	}
	if items, ok := input.(InputItems); ok {
		return items
	}
	return nil
}

// LastUserInput returns the last user-provided text from an Input.
// For InputString it returns the string itself; for InputItems it returns the
// last InputString in the list (skipping tool calls/results). Returns "" if none found.
func LastUserInput(input Input) string {
	switch v := input.(type) {
	case InputString:
		return string(v)
	case InputItems:
		for i := len(v) - 1; i >= 0; i-- {
			if s, ok := v[i].(InputString); ok {
				return string(s)
			}
		}
	}
	return ""
}
