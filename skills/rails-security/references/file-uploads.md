# File Uploads

Upload verification and serving rules for the `rails-security` skill.

The `content_type` a client sends is attacker-controlled, and `blob.content_type` is not a
substitute for it. Active Storage derives that column through `Marcel::MimeType.for`, which
treats the client's declared type as one candidate alongside magic-byte detection and keeps
it when the bytes match nothing known — so opaque bytes declared `image/png` are stored as
`image/png` with `identified?` true. Inspect the stored bytes yourself:

```ruby
module Uploads
  Rejected = Class.new(StandardError)

  MAGIC = {
    "application/pdf" => "%PDF-".b,
    "image/png" => "\x89PNG\r\n\x1a\n".b,
    "image/jpeg" => "\xFF\xD8\xFF".b
  }.freeze
  ALLOWED_EXTENSIONS = %w[.pdf .png .jpg .jpeg].freeze
  MAX_BYTES = 10.megabytes

  def self.verified!(blob)
    # Fail closed: an object that is missing or still pending cannot be inspected.
    raise Rejected, "could not be verified" unless blob.service.exist?(blob.key)
    raise Rejected, "is too large" if blob.byte_size > MAX_BYTES

    extension = File.extname(blob.filename.to_s).downcase
    raise Rejected, "extension not allowed" unless ALLOWED_EXTENSIONS.include?(extension)

    head = blob.service.download_chunk(blob.key, 0...8)
    raise Rejected, "type not allowed" unless MAGIC.any? { |_mime, magic| head.start_with?(magic) }

    blob
  end
end
```

The check reads from storage, so it has to run where the bytes already exist. A form upload
is not yet in storage when model validations run — Active Storage uploads on save — so
upload explicitly first, and attach only what passed:

```ruby
# Form upload
blob = ActiveStorage::Blob.create_and_upload!(io: params[:file], filename: params[:file].original_filename)
document.file.attach(Uploads.verified!(blob))

# Direct upload: the client already stored the object, so verify before the record
# points at it.
document.file.attach(Uploads.verified!(ActiveStorage::Blob.find_signed!(params[:file])))
```

Attach to a private service — a public bucket makes every upload world-readable regardless
of the checks above.

```ruby
has_one_attached :file, service: :private_documents
```

`rails_blob_url` and `url_for(attachment)` are stable references that never expire; they
redirect to a short-lived service URL, so anyone holding one keeps access. Serve
user-scoped files from your own controller that authorizes each request, with
`config.active_storage.draw_routes = false`, which removes every default Active Storage
route; apps using direct uploads need a replacement route:

```ruby
get "documents/:id/file", to: "document_files#show", as: :document_file
# Rails' direct-upload endpoint has no authentication of its own. This example uses a
# hand-rolled session sign-in; see Devise or the Rails 8 generator for their equivalents.
constraints ->(req) { req.session[:user_id].present? } do
  post "uploads", to: "active_storage/direct_uploads#create", as: :rails_direct_uploads
end

class DocumentPolicy < ApplicationPolicy
  def show?
    record.user_id == user.id
  end
end

class DocumentFilesController < ApplicationController
  def show
    document = current_user.documents.find(params[:id])
    authorize document, :show?
    redirect_to document.file.blob.url(expires_in: 5.minutes), allow_other_host: true
  end
end
```

Never interpolate a user-supplied path into `send_file`:

```ruby
# Bad: path traversal
send_file Rails.root.join("storage", params[:name])
```
