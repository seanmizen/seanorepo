package job

import (
	"errors"
	"sync"
	"time"
)

// Status represents the lifecycle state of a conversion job.
type Status string

const (
	StatusQueued     Status = "queued"
	StatusProcessing Status = "processing"
	StatusDone       Status = "done"
	StatusError      Status = "error"
)

// Job represents a single conversion task.
type Job struct {
	ID           string    `json:"id"`
	Status       Status    `json:"status"`
	OriginalName string    `json:"originalName"`
	OutputFormat string    `json:"outputFormat"`
	Progress     int       `json:"progress"`
	ErrorMsg     string    `json:"error,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`

	// Internal file paths — not exposed in JSON responses.
	InputPath  string `json:"-"`
	OutputPath string `json:"-"`
}

// Queue is a thread-safe job store and dispatch channel.
type Queue struct {
	mu   sync.RWMutex
	jobs map[string]*Job
	ch   chan *Job
}

func NewQueue(bufferSize int) *Queue {
	return &Queue{
		jobs: make(map[string]*Job),
		ch:   make(chan *Job, bufferSize),
	}
}

// Submit stores a job and enqueues it for a worker. Returns an error if the queue is full.
func (q *Queue) Submit(j *Job) error {
	q.mu.Lock()
	q.jobs[j.ID] = j
	q.mu.Unlock()

	select {
	case q.ch <- j:
		return nil
	default:
		q.mu.Lock()
		j.Status = StatusError
		j.ErrorMsg = "server busy — try again later"
		q.mu.Unlock()
		return errors.New("queue full")
	}
}

// Get returns the job with the given ID (nil, false if not found).
func (q *Queue) Get(id string) (*Job, bool) {
	q.mu.RLock()
	defer q.mu.RUnlock()
	j, ok := q.jobs[id]
	return j, ok
}

// SetProcessing marks the job as processing.
func (q *Queue) SetProcessing(id string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if j, ok := q.jobs[id]; ok {
		j.Status = StatusProcessing
	}
}

// SetProgress updates a job's progress percentage.
func (q *Queue) SetProgress(id string, pct int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if j, ok := q.jobs[id]; ok {
		j.Progress = pct
	}
}

// Complete marks a job as done and records the output path.
func (q *Queue) Complete(id, outputPath string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if j, ok := q.jobs[id]; ok {
		j.Status = StatusDone
		j.Progress = 100
		j.OutputPath = outputPath
	}
}

// Fail marks a job as errored.
func (q *Queue) Fail(id string, err error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if j, ok := q.jobs[id]; ok {
		j.Status = StatusError
		j.ErrorMsg = err.Error()
	}
}

// Chan returns the read-only dispatch channel consumed by workers.
func (q *Queue) Chan() <-chan *Job {
	return q.ch
}
