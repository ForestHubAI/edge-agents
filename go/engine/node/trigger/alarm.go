// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ForestHubAI/edge-agents/go/engine"
)

// Alarm fires at a specific local time of day, optionally restricted to
// a set of weekdays. Empty Days means every day.
type Alarm struct {
	engine.TriggerNode
	Hour   int
	Minute int
	Days   []time.Weekday // empty → daily

	now   func() time.Time // injected for tests; defaults to time.Now
	timer *time.Timer
}

var dayToWeekday = map[string]time.Weekday{
	"sun": time.Sunday,
	"mon": time.Monday,
	"tue": time.Tuesday,
	"wed": time.Wednesday,
	"thu": time.Thursday,
	"fri": time.Friday,
	"sat": time.Saturday,
}

// NewAlarm builds an Alarm from a "HH:MM" string and an optional list of
// day abbreviations ("mon", "tue", ...). Returns an error on malformed input.
func NewAlarm(id string, timeOfDay string, days []string) (*Alarm, error) {
	h, m, err := parseHHMM(timeOfDay)
	if err != nil {
		return nil, fmt.Errorf("alarm %s: %w", id, err)
	}
	weekdays, err := parseDays(days)
	if err != nil {
		return nil, fmt.Errorf("alarm %s: %w", id, err)
	}
	return &Alarm{
		TriggerNode: engine.NewTriggerNode(id),
		Hour:        h,
		Minute:      m,
		Days:        weekdays,
		now:         time.Now,
	}, nil
}

func (a *Alarm) Setup(_ context.Context) error {
	a.timer = time.NewTimer(a.nextDelay(a.now()))
	return nil
}

func (a *Alarm) Wait(ctx context.Context) (engine.Event, error) {
	select {
	case <-ctx.Done():
		return engine.Event{}, ctx.Err()
	case <-a.timer.C:
		a.timer.Reset(a.nextDelay(a.now()))
		return engine.Event{TargetState: a.Target()}, nil
	}
}

func (a *Alarm) Close() error {
	if a.timer != nil {
		a.timer.Stop()
	}
	return nil
}

// nextDelay returns the duration from now until the next matching fire time.
// Always strictly positive — if HH:MM has already passed today (or today is
// not a matching weekday), rolls forward to the next matching day.
func (a *Alarm) nextDelay(now time.Time) time.Duration {
	candidate := time.Date(now.Year(), now.Month(), now.Day(), a.Hour, a.Minute, 0, 0, now.Location())
	if !candidate.After(now) {
		candidate = candidate.AddDate(0, 0, 1)
	}
	if len(a.Days) > 0 {
		for i := 0; i < 7 && !containsWeekday(a.Days, candidate.Weekday()); i++ {
			candidate = candidate.AddDate(0, 0, 1)
		}
	}
	return candidate.Sub(now)
}

func parseHHMM(s string) (int, int, error) {
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid time %q: expected HH:MM", s)
	}
	h, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("invalid hour in %q: %w", s, err)
	}
	m, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("invalid minute in %q: %w", s, err)
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("time %q out of range (00:00-23:59)", s)
	}
	return h, m, nil
}

func parseDays(days []string) ([]time.Weekday, error) {
	if len(days) == 0 {
		return nil, nil
	}
	out := make([]time.Weekday, 0, len(days))
	for _, d := range days {
		wd, ok := dayToWeekday[strings.ToLower(d)]
		if !ok {
			return nil, fmt.Errorf("unknown day %q", d)
		}
		out = append(out, wd)
	}
	return out, nil
}

func containsWeekday(xs []time.Weekday, w time.Weekday) bool {
	return slices.Contains(xs, w)
}
