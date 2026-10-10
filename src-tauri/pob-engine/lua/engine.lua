-- Runs Path of Building headless inside POECheetah (design doc §5.1).
-- Called once with the PoB folder (holding src/ and runtime/lua/) and the
-- zlib functions implemented in Rust; returns the engine's API table.
local pobDir, inflate, deflate = ...
local srcDir = pobDir .. "/src/"
package.path = srcDir .. "?.lua;" .. pobDir .. "/runtime/lua/?.lua;" .. pobDir .. "/runtime/lua/?/init.lua;" .. package.path

-- PoB opens its files by relative path. Resolve them against src/ instead of
-- changing the app's working directory.
local function resolve(path)
	if type(path) ~= "string" or path:match("^/") or path:match("^%a:[/\\]") or path:match("^\\\\") then
		return path
	end
	return srcDir .. path
end
local rawLoadfile, rawDofile, rawOpen, rawLines = loadfile, dofile, io.open, io.lines
function loadfile(path, ...) return rawLoadfile(resolve(path), ...) end
function dofile(path) return rawDofile(resolve(path)) end
io.open = function(path, ...) return rawOpen(resolve(path), ...) end
io.lines = function(path, ...)
	if path == nil then return rawLines() end
	return rawLines(resolve(path), ...)
end
-- PoB reads command-line arguments from `arg`, as the luajit binary provides.
arg = {}
-- The wrapper waits for Enter after a startup error; there's no console here.
io.read = function() return nil end

-- Keep PoB's console output for error messages instead of printing it.
local messages = {}
print = function(...)
	local parts = {}
	for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
	messages[#messages + 1] = table.concat(parts, "\t")
	if #messages > 200 then table.remove(messages, 1) end
end

-- HeadlessWrapper.lua defines Inflate/Deflate as stubs that return "", which
-- silently drops timeless jewel data. Keep the real ones in place.
-- It also keeps PoB's main object in a local; catch it as it's set.
local zlib = { Inflate = inflate, Deflate = deflate }
local mainObject
setmetatable(_G, {
	__index = function(_, key) return zlib[key] end,
	__newindex = function(t, key, value)
		if zlib[key] ~= nil then return end
		if key == "SetMainObject" then
			local setMainObject = value
			value = function(obj)
				mainObject = obj
				return setMainObject(obj)
			end
		end
		rawset(t, key, value)
	end,
})

dofile("HeadlessWrapper.lua")
if not mainObject or mainObject.promptMsg then
	error(tostring(mainObject and mainObject.promptMsg or table.concat(messages, "\n")), 0)
end

local api = {}

local function mainSkillName()
	local ok, name = pcall(function()
		return build.calcsTab.mainEnv.player.mainSkill.activeEffect.grantedEffect.name
	end)
	return ok and name or nil
end

local function numericStats(output)
	local stats = {}
	for key, value in pairs(output) do
		if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
			stats[key] = value
		end
	end
	return stats
end

local loadedXml

local function load(xmlText)
	messages = {}
	loadedXml = nil
	mainObject.promptMsg = nil
	loadBuildFromXML(xmlText, "POECheetah")
	if mainObject.promptMsg then
		local msg = mainObject.promptMsg
		mainObject.promptMsg = nil
		error(tostring(msg), 0)
	end
	loadedXml = xmlText
end

--- Loads build XML and returns PoB's numeric main output (what its sidebar and
--- Calcs tab show), the main skill and PoB's console messages.
function api.loadBuild(xmlText)
	load(xmlText)
	return { stats = numericStats(build.calcsTab.mainOutput), mainSkill = mainSkillName(), messages = messages }
end

--- Calculates the build with an item (its text as copied in game or from the
--- trade site) in each slot it fits, as PoB's item tooltip compare does.
function api.tryItem(xmlText, itemText)
	if xmlText ~= loadedXml then load(xmlText) end
	local item = new("Item", (itemText:gsub("\r\n", "\n"):gsub("^%s+", "")))
	if not item.base then
		error("Path of Building couldn't read that item. Copy it with Ctrl+C in game or from the trade site.", 0)
	end
	item:NormaliseQuality()
	local itemsTab = build.itemsTab
	itemsTab:UpdateSockets()
	local calcFunc, calcBase = build.calcsTab:GetMiscCalculator()
	local weaponSet = itemsTab.activeItemSet.useSecondWeaponSet and 2 or 1
	local slots = {}
	for slotName, slot in pairs(itemsTab.slots) do
		if itemsTab:IsItemValidForSlot(item, slotName) and not slot.inactive
			and (not slot.weaponSet or slot.weaponSet == weaponSet) and slot.shown() then
			local current = itemsTab.items[slot.selItemId]
			local output = calcFunc({ repSlotName = slotName, repItem = item })
			slots[#slots + 1] = {
				slot = slot.label or slotName,
				replaces = current and current.name or nil,
				stats = numericStats(output),
			}
		end
	end
	table.sort(slots, function(a, b) return a.slot < b.slot end)
	return { item = item.name, before = numericStats(calcBase), slots = slots }
end

return api
