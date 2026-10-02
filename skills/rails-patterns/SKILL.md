---
name: rails-patterns
description: Ruby on Rails framework patterns for Rails 7.1+ and 8.x apps. Covers the directory contract, skinny controllers with service objects, form objects, query objects, idiomatic ActiveRecord, background jobs, ViewComponent, Hotwire, and the Rails 8 Solid stack. Use when building or reviewing Rails apps, controllers, models, services, jobs, or views.
origin: community
---

# Rails Patterns

Framework patterns for modern Ruby on Rails applications (Rails 7.1+ and 8.x). Rails is opinionated by design; these are the patterns the community has converged on for apps that stay maintainable past the 50-model mark. This skill is the "how." For the "what" and "when" (the decisions about which pattern to reach for), see the Ruby patterns rules — `rules/ruby/patterns.md` in this repository, installed as `rules/ecc/ruby/patterns.md`.

## When to Activate

- Building a Rails application (full-stack, API-only, or hybrid)
- Reviewing a PR that touches `app/` or `config/`
- Generating models, controllers, services, or jobs
- A controller action grows past ~10 lines
- A model file grows past ~200 lines
- ActiveRecord queries start appearing in controllers or views

## Core Concepts

### The directory contract

Rails apps follow a predictable structure. Add directories deliberately, not casually.

```
app/
  models/         ActiveRecord models. Persistence and domain logic close to the data.
  controllers/    HTTP request handling. Thin orchestration only.
  views/          ERB templates. No business logic.
  components/     ViewComponent classes. View logic that needs tests.
  services/       Service objects. Multi-step business operations.
  forms/          Form objects. Complex form handling across multiple models.
  queries/        Query objects. Reusable, composable ActiveRecord queries.
  jobs/           Background jobs. Async work via Solid Queue, Sidekiq, or GoodJob.
  mailers/        ActionMailer classes.
  helpers/        View helpers. Tiny presentational logic only.
  policies/       Authorization policies (if using Pundit). Optional.
  channels/       ActionCable channels for WebSocket work.
```

Avoid `app/lib/`, `app/utils/`, `app/managers/`. If something does not fit the directories above, the design usually needs rethinking, not a new directory. Truly generic code goes in `lib/`.

### Skinny controllers

Controllers receive a request, delegate to the right object, and render a response. Business logic lives elsewhere. (Per the Ruby patterns rules, extract to a service object when the controller starts carrying multiple responsibilities.)

### Service objects

The default for business operations that touch more than a single model save. Conventions that keep them consistent:

- Namespace by domain (`Invoices::Create`), not by suffix (`InvoiceCreator`).
- A class method `.call` delegates to an instance `#call`.
- Return a Result object, not a boolean or a bare record, so the caller can branch on success, errors, and the affected record.
- Wrap multi-record writes in a transaction.
- Keep each service single-purpose (`Invoices::Create`, `Invoices::MarkPaid`), never `Invoices::Manager`.

### Form objects

When a form spans multiple models or has fields that do not map to columns, use a form object rather than nested attributes or virtual attributes on the wrong model. It quacks like a model to the view (`form_with model: @form`) while composing records cleanly.

### Query objects

For ActiveRecord queries reused across controllers or services, or too complex for a scope, extract a query object that accepts a scope as input so it composes. Rule of thumb: a scope that grows past three chained conditions or starts taking parameters wants to be a query object.

### Background jobs

Offload anything slow. (Per the Ruby patterns rules, Solid Queue for greenfield Rails 8 with modest throughput; Sidekiq when you need mature observability, high throughput, or existing Redis.) Regardless of adapter: pass IDs not records, make `perform` idempotent, and set `retry_on`/`discard_on` explicitly.

### ViewComponent over partials

For view logic with conditional rendering, more than two arguments, or reuse across more than three places, prefer a ViewComponent. Components are testable in isolation and surface their interface explicitly; partials with deep conditional logic become debt.

### Hotwire: Turbo and Stimulus

The default Rails frontend stack. (Per the Ruby patterns rules, prefer Hotwire for server-rendered apps; reach for React/Vue only when interaction complexity justifies the client surface.) Turbo Frames for partial page updates, Turbo Streams for server-driven updates, Stimulus for small client-side behaviors next to the markup.

### The Rails 8 Solid stack

Rails 8 ships database-backed defaults that previously needed Redis: Solid Queue (jobs), Solid Cache (cache), Solid Cable (ActionCable). The tradeoff is more database load for one fewer infrastructure component; a good fit for modest throughput, with Redis still winning at high scale. Kamal is the default Docker-based deploy tool.

## Code Examples

### Skinny controller with a service object

```ruby
# Bad: business logic in the controller
class InvoicesController < ApplicationController
  def create
    @invoice = Invoice.new(invoice_params)
    @invoice.user = current_user
    @invoice.line_items.build(invoice_params[:line_items])
    @invoice.tax_total = TaxCalculator.new(@invoice).calculate
    @invoice.total = @invoice.line_items.sum(&:amount) + @invoice.tax_total

    if @invoice.save
      InvoiceMailer.created(@invoice).deliver_later
      AccountingExportJob.perform_later(@invoice.id)
      redirect_to @invoice, notice: "Invoice created"
    else
      render :new
    end
  end
end

# Good: controller orchestrates, service does the work
class InvoicesController < ApplicationController
  def create
    result = Invoices::Create.call(params: invoice_params, user: current_user)

    if result.success?
      redirect_to result.invoice, notice: "Invoice created"
    else
      @invoice = result.invoice
      render :new, status: :unprocessable_entity
    end
  end
end
```

### The service object

```ruby
# app/services/invoices/create.rb
module Invoices
  class Create
    # Struct keeps this runnable on every Ruby that Rails 7.1 supports.
    # On Ruby 3.2+, `Data.define(:success?, :invoice, :errors)` is a more
    # concise immutable alternative.
    Result = Struct.new(:success, :invoice, :errors, keyword_init: true) do
      def success?
        success
      end
    end

    def self.call(params:, user:)
      new(params: params, user: user).call
    end

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
      Result.new(success: true, invoice: invoice, errors: nil)
    rescue ActiveRecord::RecordInvalid => e
      Result.new(success: false, invoice: e.record, errors: e.record.errors)
    end

    private

    attr_reader :params, :user

    def build_invoice
      invoice = user.invoices.new(params.except(:line_items))
      invoice.line_items.build(params[:line_items])
      invoice.tax_total = TaxCalculator.call(invoice)
      invoice.total = invoice.line_items.sum(&:amount) + invoice.tax_total
      invoice
    end

    def send_notifications(invoice)
      InvoiceMailer.created(invoice).deliver_later
      AccountingExportJob.perform_later(invoice.id)
    end
  end
end
```

### Form object

```ruby
# app/forms/signup_form.rb
class SignupForm
  include ActiveModel::Model
  include ActiveModel::Attributes

  attribute :email, :string
  attribute :password, :string
  attribute :company_name, :string
  attribute :terms_accepted, :boolean

  validates :email, presence: true, format: URI::MailTo::EMAIL_REGEXP
  validates :password, presence: true, length: { minimum: 12 }
  validates :company_name, presence: true
  validates :terms_accepted, acceptance: true

  attr_reader :user, :company

  def save
    return false unless valid?

    ApplicationRecord.transaction do
      @company = Company.create!(name: company_name)
      @user = @company.users.create!(email: email, password: password, role: :owner)
    end
    true
  rescue ActiveRecord::RecordInvalid => e
    errors.merge!(e.record.errors)
    false
  end
end
```

### Query object

```ruby
# app/queries/invoices/overdue.rb
module Invoices
  class Overdue
    def self.call(scope: Invoice.all, as_of: Time.current)
      new(scope: scope, as_of: as_of).call
    end

    def initialize(scope:, as_of:)
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

Query objects accept a scope, so they compose: `Invoices::Overdue.call(scope: current_user.invoices)`.

### N+1 prevention

```ruby
# Bad: N+1 in the view when it calls post.author.name
@posts = Post.published

# Good: eager load
@posts = Post.published.includes(:author)
```

`includes` lets Rails choose preload vs eager_load. Force `preload` for separate queries, `eager_load` for a JOIN when filtering on the association. Since Rails 6.1, `strict_loading` raises on accidental lazy loads.

### Counter cache

```ruby
class Comment < ApplicationRecord
  belongs_to :post, counter_cache: true
end
```

```ruby
add_column :posts, :comments_count, :integer, default: 0, null: false
```

`post.comments_count` becomes a column read instead of a `COUNT(*)`. This example
assumes a new table; adding a counter cache to a table that already has rows requires a
backfill, which is out of scope here.

### Background job shape

Pass record IDs, not records. Retries make delivery at-least-once, so any job that calls
an external service must be idempotent — otherwise a transient failure after the remote
call succeeds will duplicate the effect on the next attempt.

```ruby
class AccountingExportJob < ApplicationJob
  queue_as :exports

  retry_on AccountingApi::TransientError, wait: :polynomially_longer, attempts: 5
  discard_on AccountingApi::PermanentError

  def perform(invoice_id)
    invoice = Invoice.find(invoice_id)
    export = AccountingExport.create_or_find_by!(
      invoice: invoice,
      idempotency_key: "invoice-export-#{invoice.id}-#{invoice.updated_at.to_i}"
    )
    return if export.completed_at?

    receipt = AccountingApi.export(invoice, idempotency_key: export.idempotency_key)
    export.update!(completed_at: Time.current, external_id: receipt.id)
  end
end
```

```ruby
add_index :accounting_exports, :idempotency_key, unique: true
```

The unique index is what makes this safe: when two attempts race, the database rejects
the second insert and Active Record resolves the conflict inside the call, returning the
existing row. That happens without any job-level retry — `retry_on` above covers only
`AccountingApi::TransientError`. The guard
covers the window before the remote call; passing `idempotency_key` through to the API
covers the window after it, so a crash between the API call and `update!` still resolves
to a single export.

### ViewComponent

```ruby
# app/components/invoice_status_badge_component.rb
class InvoiceStatusBadgeComponent < ViewComponent::Base
  STATUS_CLASSES = {
    draft: "bg-gray-100 text-gray-800",
    sent: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
    overdue: "bg-red-100 text-red-800"
  }.freeze

  def initialize(invoice:)
    @invoice = invoice
  end

  def call
    tag.span(@invoice.status.humanize, class: "rounded-full px-2 py-1 text-sm #{status_class}")
  end

  private

  def status_class
    STATUS_CLASSES.fetch(@invoice.status.to_sym, "bg-gray-100")
  end
end
```

```erb
<%= render InvoiceStatusBadgeComponent.new(invoice: @invoice) %>
```

### Hotwire

```erb
<%# Turbo Frame: clicking Edit replaces only this frame %>
<%= turbo_frame_tag "invoice_#{@invoice.id}" do %>
  <div class="invoice">
    <%= link_to "Edit", edit_invoice_path(@invoice) %>
  </div>
<% end %>
```

```erb
<%# Turbo Stream: app/views/comments/create.turbo_stream.erb %>
<%= turbo_stream.append "comments", @comment %>
<%= turbo_stream.update "comment_form", partial: "form", locals: { comment: Comment.new } %>
```

```javascript
// app/javascript/controllers/copy_to_clipboard_controller.js
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["source"]

  copy() {
    navigator.clipboard.writeText(this.sourceTarget.value)
  }
}
```

### Acceptable vs unacceptable callbacks

```ruby
# Acceptable: pure data normalization
class User < ApplicationRecord
  before_validation :normalize_email

  private

  def normalize_email
    self.email = email.to_s.downcase.strip
  end
end

# Move to a service instead: side effects hidden in a callback
# class User < ApplicationRecord
#   after_create :send_welcome_email  # hard to opt out of, hard to test
# end
```

### Good concern vs bad concern

```ruby
# Good: genuinely cross-cutting, reusable across unrelated models
# app/models/concerns/soft_deletable.rb
module SoftDeletable
  extend ActiveSupport::Concern

  included do
    scope :active, -> { where(deleted_at: nil) }
    scope :deleted, -> { where.not(deleted_at: nil) }
  end

  def soft_delete! = update!(deleted_at: Time.current)
  def restore! = update!(deleted_at: nil)
end

# Bad: a "concern" used by exactly one model, holding logic that belongs on it
# app/models/concerns/invoice_calculations.rb
module InvoiceCalculations
  extend ActiveSupport::Concern

  def calculate_total
    line_items.sum(&:amount) + tax_total
  end
end
# Only Invoice includes this. It isn't cross-cutting; it's Invoice's own logic
# hidden in a module for the appearance of a "skinny" model. Put it back on Invoice.
```

A concern used by only one class is just moving code; it belongs in that class. A concern should be reusable across at least two unrelated models.

## Anti-Patterns

### God controllers

Any controller past ~80 lines is doing too much. Split actions across controllers or extract to services.

### Fat models with 30+ methods

Models should know about their own data. Methods that orchestrate other models, send notifications, or coordinate workflows belong in services.

### Callback chains

`after_save :update_cache, :send_notifications, :enqueue_export` is the start of a debugging nightmare. Move them into a service that runs them explicitly.

### Nested attributes for complex forms

`accepts_nested_attributes_for` is fine for simple cases. For conditional validation or cross-model logic, use a form object.

### Default scopes on critical models

`default_scope { where(deleted: false) }` silently excludes records from every query in the app, including the ones you need for support and debugging. Prefer an explicit named scope.

### Models named after database concepts

`UserRole`, `OrderStatus`, `InvoiceState` are usually enum candidates, not models.

### Reaching for a JS framework before Hotwire

If the page is server-rendered with occasional interactivity, Hotwire ships faster. Reserve React/Vue for genuinely SPA-shaped apps.

## Best Practices

- Keep controllers thin; push business logic into services.
- Return Result objects from services so callers branch on outcome, not exceptions.
- Wrap multi-record writes in a transaction; let notification/side-effect failures log without breaking the primary write.
- Pass IDs to jobs, keep `perform` idempotent, set retry/discard explicitly.
- Default to eager loading; treat an accidental N+1 as a bug, not a nuisance.
- Reserve concerns for behavior shared across at least two unrelated models.
- Reach for Hotwire before a client-side framework on server-rendered apps.

## Related Skills

- `backend-patterns` — service boundaries and adapter patterns (referenced by the Ruby patterns rules)
- Ruby patterns rules (`rules/ruby/patterns.md`, installed as `rules/ecc/ruby/patterns.md`) — the decisions and when-to-use guidance this skill implements
