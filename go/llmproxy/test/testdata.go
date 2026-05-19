package test

import (
	"context"
)

// ----- Response format ----- //

// WeatherForecast demonstrates a nested response format
type WeatherForecast struct {
	Location    string      `json:"location"`
	Conditions  string      `json:"conditions"`
	Temperature Temperature `json:"temperature"`
	Alerts      []string    `json:"alerts"`
}

// Temperature shows nested structure support
type Temperature struct {
	Current float64 `json:"current"`
	High    float64 `json:"high"`
	Low     float64 `json:"low"`
	Unit    string  `json:"unit"`
}

// ----- Function tools ----- //

// Weather represents the weather information returned by the GetWeather tool.
type Weather struct {
	City             string `json:"city"`
	TemperatureRange string `json:"temperature_range"`
	Conditions       string `json:"conditions"`
}

// GetWeatherArgs represents the arguments for the GetWeather tool.
type GetWeatherArgs struct {
	City string `json:"city"`
}

// GetWeather returns the current weather information for a specified city.
func GetWeather(_ context.Context, args GetWeatherArgs) (Weather, error) {
	return Weather{
		City:             args.City,
		TemperatureRange: "14-20C",
		Conditions:       "Sunny with wind.",
	}, nil
}
