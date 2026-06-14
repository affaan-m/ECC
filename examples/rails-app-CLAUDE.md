# Rails Application: Project CLAUDE.md

> Real-world example for a Rails 8 monolithic web application with Hotwire, ViewComponent, and the Solid stack.
> Copy this to your project root and customize for your service.

## Project Overview

**Stack:** Ruby 3.3+, Rails 8.x, PostgreSQL 16, SolidQueue, SolidCache, SolidCable, Hotwire (Turbo + Stimulus), ViewComponent, Tailwind CSS, RSpec, FactoryBot, Capybara, Kamal

**Architecture:** Full-stack Rails monolith. Server-rendered with Hotwire for interactivity rather than an SPA. Database-backed Solid stack replaces Redis for background jobs, cache, and WebSockets. ViewComponent for testable view logic. Service objects for business operations. Deployed via Kamal to self-managed Linux hosts.

## Critical Rules

### Ruby Conventions

- `# frozen_string_literal: true` at the top of every Ruby file
- Modern hash syntax (`key:`) over hash rockets (`:key =>`) unless the key is not a symbol
- Double quotes by default; single quotes only when the string contains a double quote
- Two-space indentation, no tabs
- Use `bin/` wrappers (`bin/rails`, `bin/rspec`, `bin/rubocop`) instead of `bundle exec` directly
- RuboCop is authoritative; either fix the code or update the config in a PR that explains why
- No `puts`, `pp`, `debugger`, or `binding.pry` in committed code; use `Rails.logger.<level>` for logging

### Database

- Eager load associations by default to prevent N+1 queries
- Avoid `default_scope`; use named scopes that callers opt into
- Use `.includes`, `.preload`, or `.eager_load` depending on need to avoid N+1 queries
- Counter caches on any `has_many` where the count is displayed in lists
- Callbacks for data normalization only (`before_validation :normalize_email`); anything with side effects belongs in a service
- Migrations are reversible by default; document any one-way migration explicitly

```ruby
# BAD: N+1 query
posts = Post.published
posts.each { |post| post.author.name }  # one query per post

# GOOD: Single query with eager load
posts = Post.published.includes(:author)
posts.each { |post| post.author.name }
```

### Authentication and Authorization

- Authentication via the Rails 8 generated authentication system (`bin/rails generate authentication`) or Devise for more complex flows
- Session-based auth for full-stack pages, token-based for any embedded API endpoints
- Authorization via Pundit; every controller action has an `authorize` call or an explicit `skip_authorization` with a documented reason
- Strong parameters always; never `params.permit!`
- CSRF protection enabled by default; only disable per action with explicit justification

### Background Jobs

- SolidQueue is the default in Rails 8; Sidekiq remains acceptable for high-throughput cases
- Pass IDs to jobs, not records; this avoids `ActiveJob::DeserializationError` when records are deleted between enqueue and execute
- `perform` methods must be idempotent; assume they will run more than once
- Declare retry behavior explicitly with `retry_on` and `discard_on`
- Name jobs by action (`SendInvoiceJob`, `ExportAccountingJob`), not by noun
- For jobs touching external systems, pair the local idempotency check with an API-level idempotency token, and consider row-level locking (`with_lock`) for high-concurrency scenarios

### Views and Hotwire

- Hotwire (Turbo + Stimulus) before reaching for a JavaScript framework
- ViewComponent for any view logic that has conditionals, accepts multiple parameters, or appears in more than three places
- ERB partials for simple presentation; no business logic in views
- Tailwind utility classes for styling; avoid custom CSS unless utilities cannot express the design
- Turbo Frames for partial page updates; Turbo Streams for server-driven multi-update responses

### Real-time and ActionCable

- SolidCable is the Rails 8 default pub/sub backend; no Redis required
- Authenticate connections in `ApplicationCable::Connection#connect`; never trust the client to identify itself
- Authorize subscriptions in each channel's `subscribed` method before calling `stream_from`
- Prefer Turbo Stream broadcasts (`broadcasts_to`, `broadcast_replace_later_to`) for view updates over hand-written channels
- Treat ActionCable broadcasts as public; never include sensitive data the subscriber should not see

### Deployment Setup

Production deploys via Kamal:

- `config/deploy.yml` is the source of truth for servers, registry, and environment config
- `.kamal/secrets` references secrets from the host environment; the file is committed, the secrets are not
- Production hosts are Docker-capable machines (typically Linux) with SSH access from the deploying machine
- Migrations run as part of the deploy lifecycle; no manual migration step

### Error Handling

- Service objects return Result objects on success and failure; do not raise across service boundaries
- Rescue expected errors inside the service and capture them on the result
- Custom domain errors live in a dedicated location (`app/errors/` or `lib/errors/`, autoloaded as configured); one error class per failure mode
- Never expose internal error details to clients; user-facing errors come from explicit messages, not exception strings
- Use `rescue_from` sparingly in controllers; let the default Rails error handling do its job

### Code Style

- No emojis in code or comments
- Max line length 120 characters (RuboCop default)
- Classes PascalCase, methods and variables snake_case, constants UPPER_SNAKE_CASE
- Controllers stay under 80 lines; models stay under 200 lines; anything longer needs extraction
- Service objects under `app/services/`, namespaced by domain (`Invoices::Create`, not `InvoiceCreator`)

## File Structure

```
app/
  models/                # ActiveRecord models. Persistence and domain logic close to the data.
  controllers/           # HTTP request handling. Thin orchestration only.
  views/                 # ERB templates. No business logic.
  components/            # ViewComponent classes. View logic that needs tests.
  services/              # Service objects under domain namespaces.
  forms/                 # Form objects for multi-model forms.
  queries/               # Query objects for reusable, composable ActiveRecord queries.
  jobs/                  # Background jobs. SolidQueue or Sidekiq.
  mailers/               # ActionMailer classes.
  channels/              # ActionCable channels. Real-time WebSocket connections.
  policies/              # Pundit authorization policies, one per resource.
  errors/                # Custom domain error classes.
config/
  routes.rb
  database.yml
  credentials/
    production.yml.enc   # Encrypted production credentials.
  deploy.yml             # Kamal deploy configuration.
db/
  migrate/               # Migrations, committed and reversible.
  seeds.rb
spec/
  models/
  services/
  components/
  system/                # Capybara system tests.
  factories/             # FactoryBot definitions.
  support/               # Shared spec helpers.
```

## Key Patterns

### Service Object Pattern

```ruby
# app/services/invoices/create.rb
module Invoices
  class Create
    Result = Data.define(:success?, :invoice, :errors)

    def self.call(...) = new(...).call

    def initialize(params:, user:)
      @params = params
      @user = user
    end

    def call
      invoice = build_invoice

      ApplicationRecord.transaction do
        invoice.save!
      end

      begin
        send_notifications(invoice)
      rescue StandardError => e
        Rails.logger.error("Notification dispatch failed for invoice #{invoice.id}: #{e.message}")
      end

      Result.new(success?: true, invoice: invoice, errors: nil)
    rescue ActiveRecord::RecordInvalid => e
      Result.new(success?: false, invoice: e.record, errors: e.record.errors)
    end

    private

    attr_reader :params, :user

    def build_invoice
      invoice = user.invoices.new(params.except(:line_items))
      invoice.line_items.build(params[:line_items])
      invoice.total = invoice.line_items.sum(&:amount)
      invoice
    end

    def send_notifications(invoice)
      InvoiceMailer.created(invoice).deliver_later
      ExportAccountingJob.perform_later(invoice.id)
    end
  end
end
```

### Skinny Controller Pattern

```ruby
# app/controllers/invoices_controller.rb
class InvoicesController < ApplicationController
  before_action :require_authentication  # Rails 8 generator default; use authenticate_user! with Devise

  def create
    authorize Invoice

    result = Invoices::Create.call(params: invoice_params, user: current_user)

    if result.success?
      redirect_to result.invoice, notice: "Invoice created"
    else
      @invoice = result.invoice
      render :new, status: :unprocessable_entity
    end
  end

  private

  def invoice_params
    params.require(:invoice).permit(:customer_id, line_items: %i[description amount])
  end
end
```

### Query Object Pattern

```ruby
# app/queries/invoices/overdue.rb
module Invoices
  class Overdue
    def self.call(...) = new(...).call

    def initialize(scope: Invoice.all, as_of: Time.current)
      @scope = scope
      @as_of = as_of
    end

    def call
      scope
        .where(status: :sent)
        .where(due_date: ..as_of)
        .where.not(id: paid_invoice_ids)
        .includes(:customer, :line_items)
    end

    private

    attr_reader :scope, :as_of

    def paid_invoice_ids
      Payment.where(created_at: ..as_of).pluck(:invoice_id)
    end
  end
end
```

### Background Job Pattern

```ruby
# app/jobs/export_accounting_job.rb
class ExportAccountingJob < ApplicationJob
  queue_as :exports

  retry_on AccountingApi::TransientError, wait: :polynomially_longer, attempts: 5
  discard_on AccountingApi::PermanentError

  def perform(invoice_id)
    invoice = Invoice.find(invoice_id)
    return if invoice.exported_at.present?  # local idempotency check

    idempotency_key = "invoice-export-#{invoice.id}"
    AccountingApi.export(invoice, idempotency_key: idempotency_key)
    invoice.update!(exported_at: Time.current)
  end
end
```

### Test Pattern (RSpec)

```ruby
# spec/services/invoices/create_spec.rb
require "rails_helper"

RSpec.describe Invoices::Create do
  let(:user) { create(:user) }
  let(:customer) { create(:customer, user: user) }
  let(:params) do
    {
      customer_id: customer.id,
      line_items: [{ description: "Consulting", amount: 100_000 }]  # $1,000.00 in cents
    }
  end

  describe ".call" do
    it "creates an invoice with the expected total" do
      result = described_class.call(params: params, user: user)

      expect(result).to be_success
      expect(result.invoice).to be_persisted
      expect(result.invoice.total).to eq(100_000)
    end

    it "enqueues a notification email" do
      expect {
        described_class.call(params: params, user: user)
      }.to have_enqueued_mail(InvoiceMailer, :created)
    end

    it "returns errors when validation fails" do
      result = described_class.call(params: params.merge(customer_id: nil), user: user)

      expect(result).not_to be_success
      expect(result.errors[:customer]).to include("must exist")
    end
  end
end
```

## Environment Variables

```bash
# Rails
RAILS_ENV=production
RAILS_MASTER_KEY=                  # decrypts config/credentials/production.yml.enc
SECRET_KEY_BASE=                   # auto-generated; never commit

# Database
DATABASE_URL=postgres://user:pass@host:5432/myapp_production

# SolidQueue, SolidCache, SolidCable
# These default to the primary database; configure a separate one for higher load:
QUEUE_DATABASE_URL=postgres://user:pass@host:5432/myapp_queue
CACHE_DATABASE_URL=postgres://user:pass@host:5432/myapp_cache

# Kamal deploy
KAMAL_REGISTRY_PASSWORD=
KAMAL_DEPLOY_USER=

# Application secrets (also storable in Rails encrypted credentials)
STRIPE_API_KEY=
SENTRY_DSN=
```

For most secrets, prefer Rails encrypted credentials (`bin/rails credentials:edit -e production`) over environment variables. ENV vars are appropriate for infrastructure config that varies per host; credentials are appropriate for application secrets that travel with the codebase.

## Testing Strategy

```bash
# Run the full suite
bin/rspec

# Run a single file or directory
bin/rspec spec/services/invoices/
bin/rspec spec/services/invoices/create_spec.rb

# Run only the last failures
bin/rspec --only-failures

# Run with random ordering (default) seeded for reproducibility
bin/rspec --seed 12345

# Run system tests
bin/rspec spec/system/

# Coverage report (SimpleCov)
COVERAGE=true bin/rspec
```

Coverage target is 90% line coverage as a floor, not a goal. Sharp tests with 85% beat exhaustive tests with 100%. System tests use Capybara with the rack_test driver by default and switch to headless Chrome only when JavaScript is required.

## ECC Workflow

```bash
# Planning
/plan "Add invoice PDF export with line item subtotals"

# Test-first development
/tdd                    # RSpec-based TDD workflow

# Review
/code-review            # General quality check
/security-scan          # Brakeman + dependency audit

# Verification
/verify                 # Lint, type-check, test, security scan in one pass
```

## Git Workflow

- Branch from `main`, named `<type>/<short-description>` (e.g., `feat/invoice-pdf-export`, `fix/n-plus-one-on-dashboard`)
- Conventional commits style: `feat:` new features, `fix:` bug fixes, `refactor:` code changes
- Pull requests required for changes to `main`; review according to your team's policy and CI must be green to merge
- Squash on merge; the merged commit message must be coherent and well-formed
- Never force-push to `main`; force-pushing feature branches is fine
- CI runs RuboCop, Brakeman, RSpec, and bundle audit on every PR
