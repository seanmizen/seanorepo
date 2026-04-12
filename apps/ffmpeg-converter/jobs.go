package main

import (
	"sync"
	"time"
)

type JobStatus string

const (
	StatusPending JobStatus = "pending"
	StatusRunning JobStatus = "running"
	StatusDone    JobStatus = "done"
	StatusError   JobStatus = "error"
)

type Job struct {
	ID         string    `json:"id"`
	Op         string    `json:"op"`
	Status     JobStatus `json:"status"`
	OutputPath string    `json:"output_path,omitempty"`
	Error      string    `json:"error,omitempty"`
	StartedAt  time.Time `json:"started_at"`
	EndedAt    time.Time `json:"ended_at,omitempty"`
}

type JobTracker struct {
	mu   sync.RWMutex
	jobs map[string]*Job
}

func NewJobTracker() *JobTracker {
	return &JobTracker{jobs: make(map[string]*Job)}
}

func (jt *JobTracker) Create(op string) *Job {
	j := &Job{
		ID:        randomID(),
		Op:        op,
		Status:    StatusPending,
		StartedAt: time.Now(),
	}
	jt.mu.Lock()
	jt.jobs[j.ID] = j
	jt.mu.Unlock()
	return j
}

func (jt *JobTracker) Get(id string) (*Job, bool) {
	jt.mu.RLock()
	defer jt.mu.RUnlock()
	j, ok := jt.jobs[id]
	return j, ok
}

func (jt *JobTracker) Update(id string, fn func(*Job)) {
	jt.mu.Lock()
	defer jt.mu.Unlock()
	if j, ok := jt.jobs[id]; ok {
		fn(j)
	}
}
