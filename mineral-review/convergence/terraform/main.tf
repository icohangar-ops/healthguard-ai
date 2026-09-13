# Convergence — Post-Merger Integration Intelligence Platform
# Terraform configuration for DigitalOcean

variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "project_name" {
  description = "DigitalOcean project name"
  type        = string
  default     = "convergence"
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc3"
}

variable "environment" {
  description = "Environment (dev | staging | prod)"
  type        = string
  default     = "dev"
}

# =============================================
# Provider
# =============================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.36"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

# =============================================
# Project
# =============================================

resource "digitalocean_project" "convergence" {
  name        = var.project_name
  description = "Convergence — Post-Merger Integration Intelligence Platform"
  environment = var.environment
  resources   = []
}

# =============================================
# Managed PostgreSQL
# =============================================

resource "digitalocean_database_cluster" "convergence_pg" {
  name       = "convergence-pg-${var.environment}"
  engine     = "pg"
  version    = "16"
  size       = "db-s-1vcpu-1gb"
  region     = var.region
  node_count = 1

  backup {
    enabled = true
  }

  maintenance_window {
    day  = "sunday"
    hour = "03:00"
  }
}

resource "digitalocean_database_db" "convergence_db" {
  cluster_id = digitalocean_database_cluster.convergence_pg.id
  name       = "convergence"
}

resource "digitalocean_database_user" "convergence_app" {
  cluster_id = digitalocean_database_cluster.convergence_pg.id
  name       = "convergence_app"
}

resource "digitalocean_database_firewall" "convergence_pg_fw" {
  cluster_id = digitalocean_database_cluster.convergence_pg.id

  rule {
    type  = "app"
    value = digitalocean_app.convergence_api.id
  }
}

# =============================================
# Spaces (S3-compatible object storage)
# =============================================

resource "digitalocean_spaces_bucket" "convergence_artifacts" {
  name   = "convergence-artifacts-${var.environment}-${random_id.bucket_suffix.hex}"
  region = var.region
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "digitalocean_spaces_bucket_object" "init_marker" {
  bucket = digitalocean_spaces_bucket.convergence_artifacts.name
  key    = ".convergence-initialized"
  content = jsonencode({
    initialized_at = timestamp()
    environment    = var.environment
  })
}

# =============================================
# App Platform — Python API
# =============================================

resource "digitalocean_app" "convergence_api" {
  spec {
    name   = "convergence-api-${var.environment}"
    region = var.region

    service {
      name               = "convergence-api"
      instance_count     = 1
      instance_size_slug = "basic-xxs"
      source_dir         = "."

      run_command = "pip install -e '.[dev,postgres,spaces]' && uvicorn convergence.api.main:app --host 0.0.0.0 --port ${var.api_port}"

      http_port = var.api_port

      environment {
        key   = "APP_ENVIRONMENT"
        value = var.environment
      }

      environment {
        key   = "DATABASE_URL"
        value = digitalocean_database_cluster.convergence_pg.uri
      }

      env {
        key  = "CONVERGENCE_API_KEY"
        type = "SECRET"
        name = "convergence-api-key"
      }

      env {
        key  = "MODEL_ACCESS_KEY"
        type = "SECRET"
        name = "convergence-do-inference-key"
      }

      health_check {
        http_path = "/api/v1/health"
        interval_seconds = 30
        timeout_seconds  = 10
        retries           = 3
      }
    }
  }
}

variable "api_port" {
  description = "Port for the API service"
  type        = number
  default     = 8080
}

# =============================================
# Outputs
# =============================================

output "api_url" {
  description = "Convergence API URL"
  value       = digitalocean_app.convergence_api.live_url
}

output "database_uri" {
  description = "PostgreSQL connection URI"
  value       = digitalocean_database_cluster.convergence_pg.uri
  sensitive   = true
}

output "spaces_bucket" {
  description = "Spaces bucket name for artifacts"
  value       = digitalocean_spaces_bucket.convergence_artifacts.name
}

output "project_id" {
  description = "DigitalOcean project ID"
  value       = digitalocean_project.convergence.id
}
