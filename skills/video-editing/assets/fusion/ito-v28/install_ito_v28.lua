-- Run this file with Resolve's fuscript interpreter or Lua dofile().
-- Keep the three .setting files beside it. Existing ITO_V22 files are untouched.
local function need(ok, message)
  if not ok then error(message, 0) end
  return ok
end
local function read(path)
  local file, message, code = io.open(path, "rb")
  if not file then
    need(code == 2, "Could not read " .. path .. ": " .. tostring(message))
    return nil
  end
  local value = file:read("*a")
  file:close()
  need(value ~= nil, "Read failed: " .. path)
  return value
end
local function quote(value)
  return "'" .. value:gsub("'", "'\\''") .. "'"
end
local script = debug.getinfo(1, "S").source
need(script:sub(1, 1) == "@", "Run the saved installer file, not pasted text")
local sourceDir = need(script:sub(2):match("^(.*)/[^/]+$"), "Use the installer absolute path")
local userHome = need(os.getenv("HOME"), "HOME is unavailable")
local targetDir = userHome .. "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Macros/ITO_V28"
local names = {
  "ITO_V28_FlashEtherealBloom.setting",
  "ITO_V28_RGBDisplacement.setting",
  "ITO_V28_SubjectHalo.setting",
}
local payloads = {}
for _, name in ipairs(names) do
  local payload = need(read(sourceDir .. "/" .. name), "Missing source setting: " .. name)
  need(#payload > 0, "Empty source setting: " .. name)
  local existing = read(targetDir .. "/" .. name)
  need(existing == nil or existing == payload, "Refusing to overwrite a different installed setting: " .. name)
  payloads[name] = payload
end
local result = os.execute("mkdir -p " .. quote(targetDir))
need(result == 0 or result == true, "Could not create ITO_V28 directory")
for _, name in ipairs(names) do
  local path = targetDir .. "/" .. name
  if read(path) == nil then
    local file = need(io.open(path, "wb"), "Could not create: " .. name)
    need(file:write(payloads[name]), "Write failed: " .. name)
    need(file:close(), "Close failed: " .. name)
  end
  need(read(path) == payloads[name], "Installed readback mismatch: " .. name)
  print("VERIFIED " .. name)
end
print("ITO_V28_INSTALLED " .. targetDir)
