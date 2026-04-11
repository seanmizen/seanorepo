package main

import (
	"testing"

	rs "github.com/seanmizen/relay-shared"
)

func TestDryRun_MissingVars(t *testing.T) {
	wa := NewWhatsAppClient("", "", "")
	if !wa.dryRun {
		t.Fatal("expected dry-run mode when all env vars empty")
	}
}

func TestDryRun_PartialVars(t *testing.T) {
	wa := NewWhatsAppClient("phone-id", "", "")
	if !wa.dryRun {
		t.Fatal("expected dry-run mode when token is missing")
	}
}

func TestNotDryRun_AllVarsSet(t *testing.T) {
	wa := NewWhatsAppClient("phone-id", "token", "+1234567890")
	if wa.dryRun {
		t.Fatal("should not be in dry-run mode when all vars set")
	}
}

func TestDryRun_Send(t *testing.T) {
	wa := NewWhatsAppClient("", "", "")
	id, err := wa.Send(rs.NotifyRequest{Message: "hello"})
	if err != nil {
		t.Fatalf("dry-run Send should not error: %v", err)
	}
	if id != "dry-run-id" {
		t.Fatalf("expected 'dry-run-id', got %q", id)
	}
}

func TestBuildBody_MessageOnly(t *testing.T) {
	got := buildBody(rs.NotifyRequest{Message: "simple"})
	if got != "simple" {
		t.Fatalf("expected 'simple', got %q", got)
	}
}

func TestBuildBody_WithTitle(t *testing.T) {
	got := buildBody(rs.NotifyRequest{Title: "Build done", Message: "Tests passed"})
	want := "Build done\nTests passed"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBuildBody_HighPriority(t *testing.T) {
	got := buildBody(rs.NotifyRequest{Message: "URGENT", Priority: rs.PriorityHigh})
	want := "URGENT\n[!] HIGH PRIORITY"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBuildBody_TitleAndHighPriority(t *testing.T) {
	got := buildBody(rs.NotifyRequest{
		Title:    "Deploy: carolinemizen.art",
		Message:  "Deployment failed",
		Priority: rs.PriorityHigh,
	})
	want := "Deploy: carolinemizen.art\nDeployment failed\n[!] HIGH PRIORITY"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBuildBody_LowPriority_NoSuffix(t *testing.T) {
	got := buildBody(rs.NotifyRequest{Message: "done", Priority: rs.PriorityLow})
	if got != "done" {
		t.Fatalf("low priority should not add suffix, got %q", got)
	}
}

func TestBuildBody_NormalPriority_NoSuffix(t *testing.T) {
	got := buildBody(rs.NotifyRequest{Message: "done", Priority: rs.PriorityNormal})
	if got != "done" {
		t.Fatalf("normal priority should not add suffix, got %q", got)
	}
}
