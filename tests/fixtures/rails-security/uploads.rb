# Exercises the upload verifier published in skills/rails-security/SKILL.md against a real
# Active Storage lifecycle: a migrated database, a disk service holding real bytes, and
# blobs created the way Rails creates them.
#
# Prints one JSON object per case to stdout. tests/skills/rails-security.test.js asserts on
# that output, so the contract is the JSON rather than this script's exit status.

require "json"
require "tmpdir"
require "fileutils"
require "stringio"
require "digest"
require "rails"
require "active_record/railtie"
require "active_storage/engine"

ROOT = Dir.mktmpdir("ecc-rails-security-")
at_exit { FileUtils.remove_entry(ROOT, true) }

FileUtils.mkdir_p(File.join(ROOT, "config"))
File.write(File.join(ROOT, "config", "database.yml"), <<~YAML)
  test:
    adapter: sqlite3
    database: ":memory:"
YAML

class FixtureApp < Rails::Application
  config.root = ROOT
  config.eager_load = false
  config.logger = Logger.new(IO::NULL)
  config.secret_key_base = "fixture-only-not-a-secret"
  config.active_support.to_time_preserves_timezone = :zone
  config.active_storage.service = :fixture_disk
  config.active_storage.service_configurations = {
    "fixture_disk" => { "service" => "Disk", "root" => File.join(ROOT, "storage") }
  }
end

FixtureApp.initialize!

ActiveRecord::Migration.verbose = false

ActiveRecord::Schema.define do
  create_table :documents

  create_table :active_storage_blobs do |t|
    t.string   :key,          null: false
    t.string   :filename,     null: false
    t.string   :content_type
    t.text     :metadata
    t.string   :service_name, null: false
    t.bigint   :byte_size,    null: false
    t.string   :checksum
    t.datetime :created_at,   null: false
    t.index [:key], unique: true
  end

  create_table :active_storage_attachments do |t|
    t.string     :name,       null: false
    t.references :record,     null: false, polymorphic: true, index: false
    t.bigint     :blob_id,    null: false
    t.datetime   :created_at, null: false
    t.index %i[record_type record_id name blob_id],
            name: :index_active_storage_attachments_uniqueness, unique: true
  end

  create_table :active_storage_variant_records do |t|
    t.bigint :blob_id, null: false
    t.string :variation_digest, null: false
    t.index %i[blob_id variation_digest],
            name: :index_active_storage_variant_records_uniqueness, unique: true
  end
end

class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true
end

class Document < ApplicationRecord
  has_one_attached :file
end

# --- The published verifier, copied from the skill --------------------------------------

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

# --- Cases ------------------------------------------------------------------------------

PNG_BYTES = "\x89PNG\r\n\x1a\n".b + ("\x00".b * 64)
ZIP_BYTES = "PK\x03\x04".b + ("\x00".b * 64)
OPAQUE_BYTES = "\x01\x02\x03\x04".b * 20

def upload(bytes, filename, declared)
  ActiveStorage::Blob.create_and_upload!(
    io: StringIO.new(bytes), filename: filename, content_type: declared
  )
end

def report(name, blob)
  outcome = nil
  begin
    document = Document.create!
    document.file.attach(Uploads.verified!(blob))
    outcome = { case: name, attached: document.reload.file.attached?, rejected: nil }
  rescue Uploads::Rejected => error
    outcome = { case: name, attached: false, rejected: error.message }
  end
  puts JSON.generate(outcome.merge(
    stored_content_type: blob.content_type,
    identified: blob.identified?
  ))
end

# 1. A real PNG passes.
report("legitimate_png", upload(PNG_BYTES, "chart.png", "image/png"))

# 2. Opaque bytes declared image/png. Marcel matches no magic, keeps the declared type,
#    and marks the blob identified — so content_type agrees with the attacker.
report("opaque_declared_png", upload(OPAQUE_BYTES, "payload.png", "image/png"))

# 3. A ZIP declared image/png. Identification does detect the real type here, which is
#    why content_type cannot be the single gate either way.
report("zip_declared_png", upload(ZIP_BYTES, "payload.png", "image/png"))

# 4. A disallowed extension on otherwise valid bytes.
report("png_bytes_bad_extension", upload(PNG_BYTES, "chart.svg", "image/png"))

# 5. A direct upload whose object never arrived: the row exists, the bytes do not.
pending = ActiveStorage::Blob.create_before_direct_upload!(
  filename: "pending.png", byte_size: PNG_BYTES.bytesize,
  checksum: Digest::MD5.base64digest(PNG_BYTES), content_type: "image/png"
)
pending.update!(identified: true)
report("pending_direct_upload", pending)

# 6. The object is deleted after identification recorded a type. The row still claims
#    image/png, so only an explicit existence check catches it.
vanished = upload(PNG_BYTES, "vanished.png", "image/png")
vanished.service.delete(vanished.key)
report("deleted_after_identification", vanished)
