package job

import (
	"context"
	"fmt"
	"log"
	"path/filepath"

	"github.com/seanmizen/converter/internal/converter"
	"github.com/seanmizen/converter/internal/storage"
)

// WorkerPool processes jobs from the Queue concurrently.
type WorkerPool struct {
	queue      *Queue
	registry   *converter.Registry
	store      *storage.TempStore
	numWorkers int
}

func NewWorkerPool(q *Queue, r *converter.Registry, s *storage.TempStore, n int) *WorkerPool {
	return &WorkerPool{queue: q, registry: r, store: s, numWorkers: n}
}

// Start launches numWorkers goroutines. They run until ctx is cancelled.
func (wp *WorkerPool) Start(ctx context.Context) {
	for i := range wp.numWorkers {
		go wp.run(ctx, i)
	}
}

func (wp *WorkerPool) run(ctx context.Context, workerID int) {
	log.Printf("worker %d ready", workerID)
	for {
		select {
		case <-ctx.Done():
			log.Printf("worker %d shutting down", workerID)
			return
		case j := <-wp.queue.Chan():
			wp.process(ctx, j)
		}
	}
}

func (wp *WorkerPool) process(ctx context.Context, j *Job) {
	wp.queue.SetProcessing(j.ID)
	log.Printf("job %s: start %s → %s", j.ID, j.OriginalName, j.OutputFormat)

	outputExt := converter.OutputExt(j.OutputFormat)
	outputPath, err := wp.store.NewFile(outputExt)
	if err != nil {
		wp.queue.Fail(j.ID, fmt.Errorf("allocate output: %w", err))
		return
	}

	inputExt := filepath.Ext(j.InputPath)
	c, err := wp.registry.FindConverter(inputExt)
	if err != nil {
		wp.queue.Fail(j.ID, err)
		_ = wp.store.Delete(outputPath)
		return
	}

	err = c.Convert(ctx, j.InputPath, outputPath, j.OutputFormat, nil, func(pct int) {
		wp.queue.SetProgress(j.ID, pct)
	})
	if err != nil {
		log.Printf("job %s: error: %v", j.ID, err)
		wp.queue.Fail(j.ID, err)
		_ = wp.store.Delete(outputPath)
		// Clean up input too on failure.
		_ = wp.store.Delete(j.InputPath)
		return
	}

	wp.queue.Complete(j.ID, outputPath)
	// Clean up input — output is kept until download or TTL expiry.
	_ = wp.store.Delete(j.InputPath)
	log.Printf("job %s: done", j.ID)
}
