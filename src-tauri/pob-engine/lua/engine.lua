-- Runs Path of Building headless inside POECheetah (design doc §5.1).
-- Called once with the PoB folder (holding src/ and runtime/lua/) and the
-- zlib functions implemented in Rust, and the metatable that makes a table
-- serialize as a JSON array even when empty; returns the engine's API table.
local pobDir, inflate, deflate, arrayMeta = ...
local function array(t) return setmetatable(t, arrayMeta) end
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

-- Analysis (design doc §3.9): recalculate the loaded build under other
-- settings and gem choices, then restore it exactly.

local configOptions = LoadModule("Modules/ConfigOptions")

local function recalc()
	build.configTab:BuildModList()
	build.buildFlag = true
	runCallback("OnFrame")
end

local function pick(output, keys)
	local out = {}
	for _, key in ipairs(keys) do
		local value = output[key]
		if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
			out[key] = value
		end
	end
	return out
end

local DEFENCE_KEYS = { "TotalEHP", "PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken",
	"LightningMaximumHitTaken", "ChaosMaximumHitTaken" }
local SCORE_KEYS = { "CombinedDPS", "TotalEHP" }

--- Config options PoB lists under "When In Combat" and "For Effective DPS":
--- the situational assumptions players tick to see higher numbers.
local function assumptionOptions()
	local options, section = {}, nil
	for _, opt in ipairs(configOptions) do
		if opt.section then
			section = opt.section
		elseif opt.var and (section == "When In Combat" or section == "For Effective DPS") then
			options[#options + 1] = opt
		end
	end
	return options
end

local function optionLabel(opt)
	return ((opt.label or opt.var):gsub("%^%x", ""):gsub("%^x%x%x%x%x%x%x", ""):gsub(":$", ""))
end

local function listLabel(opt, value)
	for _, entry in ipairs(opt.list or {}) do
		if entry.val == value then return entry.label end
	end
	return tostring(value)
end

local function findOption(var)
	for _, opt in ipairs(configOptions) do
		if opt.var == var then return opt end
	end
end

--- With the build's settings changed, run `fn` and return its result.
--- `changes` maps config vars to values; false clears a var (PoB default).
local function withConfig(original, changes, fn)
	local input = build.configTab.input
	wipeTable(input)
	for k, v in pairs(original) do input[k] = v end
	for k, v in pairs(changes) do
		if v == false then input[k] = nil else input[k] = v end
	end
	recalc()
	return fn(build.calcsTab.mainOutput)
end

local function mainSocketGroup()
	return build.skillsTab.socketGroupList[build.mainSocketGroup]
end

local function supportName(gem)
	return gem.gemData and gem.gemData.name or gem.nameSpec
end

--- Ranks support gems for the main skill: what each current support is worth,
--- then the best replacements for the least valuable one.
local function rankSupports(maxCandidates)
	local group = mainSocketGroup()
	local mainSkill = build.calcsTab.mainEnv.player.mainSkill
	if not group or not mainSkill then return nil end
	local base = build.calcsTab.mainOutput.CombinedDPS or 0
	if base <= 0 then return nil end

	local current, inGroup = {}, {}
	for _, gem in ipairs(group.gemList) do
		if gem.gemData then inGroup[gem.gemData.name] = true end
		if gem.enabled ~= false and gem.gemData and gem.gemData.grantedEffect and gem.gemData.grantedEffect.support then
			gem.enabled = false
			recalc()
			current[#current + 1] = { gem = gem, name = supportName(gem), dpsWithout = build.calcsTab.mainOutput.CombinedDPS or 0 }
			gem.enabled = true
		end
	end
	recalc()
	if #current == 0 then return nil end
	table.sort(current, function(a, b) return a.dpsWithout > b.dpsWithout end)
	local weakest = current[1]

	local candidates = {}
	local gem = weakest.gem
	local saved = { gemId = gem.gemId, skillId = gem.skillId, level = gem.level, quality = gem.quality }
	for gemId, gemData in pairs(build.data.gems) do
		local effect = gemData.grantedEffect
		if effect and effect.support and not inGroup[gemData.name] and not effect.unsupported
			and not gemData.name:match("^Vaal") and calcLib.canGrantedEffectSupportActiveSkill(effect, mainSkill) then
			gem.gemId, gem.skillId = gemId, nil
			build.skillsTab:ProcessSocketGroup(group)
			gem.level = gemData.naturalMaxLevel or 20
			gem.quality = 0
			recalc()
			local out = build.calcsTab.mainOutput
			candidates[#candidates + 1] = { name = gemData.name, stats = pick(out, SCORE_KEYS) }
		end
	end
	gem.gemId, gem.skillId, gem.level, gem.quality = saved.gemId, saved.skillId, saved.level, saved.quality
	build.skillsTab:ProcessSocketGroup(group)
	recalc()

	table.sort(candidates, function(a, b) return (a.stats.CombinedDPS or 0) > (b.stats.CombinedDPS or 0) end)
	local top = {}
	for i = 1, math.min(maxCandidates, #candidates) do top[i] = candidates[i] end
	local values = {}
	for i, c in ipairs(current) do values[i] = { name = c.name, dpsWithout = c.dpsWithout } end
	return { baseDps = base, current = values, replacing = weakest.name, candidates = top }
end

local function rankPantheon(original, var)
	local opt = findOption(var)
	local results = {}
	for _, entry in ipairs(opt.list) do
		if entry.val ~= "None" then
			results[#results + 1] = withConfig(original, { [var] = entry.val }, function(out)
				return { value = entry.val, label = entry.label, stats = pick(out, DEFENCE_KEYS) }
			end)
		end
	end
	return { current = original[var] or "None", options = results }
end

--- Honest DPS, boss check, pantheon and support gem ranking for build XML.
function api.analyse(xmlText)
	if xmlText ~= loadedXml then load(xmlText) end
	local input = build.configTab.input
	local original = copyTable(input)
	local ok, result = pcall(function()
		local configured = numericStats(build.calcsTab.mainOutput)

		-- Conservative: clear every situational assumption that is set.
		local cleared, changes = {}, {}
		for _, opt in ipairs(assumptionOptions()) do
			local value = original[opt.var]
			if opt.type ~= "list" and value ~= nil and value ~= false and value ~= 0 and value ~= ""
				and value ~= opt.defaultState then
				changes[opt.var] = false
				cleared[#cleared + 1] = opt.type == "check" and optionLabel(opt)
					or (optionLabel(opt) .. ": " .. (opt.type == "list" and listLabel(opt, value) or tostring(value)))
			end
		end
		local conservative = withConfig(original, changes, numericStats)

		local bossOpt = findOption("enemyIsBoss")
		local bossNow = original.enemyIsBoss or bossOpt.list[bossOpt.defaultIndex].val
		local uber = withConfig(original, { enemyIsBoss = "Uber" }, numericStats)

		local major = rankPantheon(original, "pantheonMajorGod")
		local minor = rankPantheon(original, "pantheonMinorGod")

		withConfig(original, {}, function() end)
		local supports = rankSupports(8)

		return {
			configured = configured,
			conservative = conservative,
			cleared = cleared,
			enemyIsBoss = listLabel(bossOpt, bossNow),
			uber = uber,
			pantheonMajor = major,
			pantheonMinor = minor,
			supports = supports,
		}
	end)
	-- Always leave the build exactly as loaded.
	wipeTable(input)
	for k, v in pairs(original) do input[k] = v end
	recalc()
	if not ok then error(result, 0) end
	return result
end

-- Passive advisor (design doc §3.1): every passive worth considering,
-- calculated with the nodes on its path, as PoB's tree tooltip does.

local PASSIVE_KEYS = { "CombinedDPS", "TotalEHP", "Life", "EnergyShield", "Mana", "Armour", "Evasion",
	"EffectiveBlockChance", "EffectiveSpellBlockChance", "EffectiveSpellSuppressionChance",
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	"PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken",
	"ChaosMaximumHitTaken" }
-- Notables and keystones up to this many points away; other nodes only when adjacent.
local MAX_NOTABLE_DISTANCE = 4

local function nodeLines(node)
	local lines = array({})
	for _, line in ipairs(node.sd or {}) do lines[#lines + 1] = line end
	return lines
end

--- A mastery effect as a node PoB can allocate in place of the mastery node.
local function masteryEffectNode(node, effect)
	local effectNode = { id = node.id, type = node.type, name = node.name, sd = {} }
	for i, line in ipairs(effect.sd or {}) do effectNode.sd[i] = line end
	build.spec.tree:ProcessStats(effectNode)
	return effectNode
end

--- Mastery effects `node` may take: those not already chosen on another node of its kind.
local function freeMasteryEffects(node)
	local spec = build.spec
	local effects = {}
	for _, entry in ipairs(node.masteryEffects or {}) do
		local takenBy = isValueInTable(spec.masterySelections, entry.effect)
		local effect = spec.tree.masteryEffects[entry.effect]
		if effect and (not takenBy or takenBy == node.id) then effects[#effects + 1] = effect end
	end
	return effects
end

--- Unallocated nodes on the way to `node`, as PoB paths them (the node included).
local function pathTo(node)
	local nodes, via = {}, array({})
	for _, n in ipairs(node.path or {}) do
		if not n.alloc then
			nodes[n] = true
			if n ~= node then via[#via + 1] = n.dn end
		end
	end
	return nodes, via
end

--- Passives to allocate next, each with the stats after taking it and the
--- nodes on its path; free swaps for allocated masteries; points spent.
function api.passives(xmlText)
	if xmlText ~= loadedXml then load(xmlText) end
	local spec = build.spec
	local granted = build.calcsTab.mainEnv.grantedPassives
	local calcFunc, calcBase = build.calcsTab:GetMiscCalculator()
	local used, ascUsed = spec:CountAllocNodes()
	local candidates, swaps = array({}), array({})
	local cache = {}

	--- Calculates `entry` (a candidate) with `override` and adds it to `list`.
	local function add(list, entry, override)
		entry.via = entry.via or array({})
		entry.stats = pick(calcFunc(override), PASSIVE_KEYS)
		list[#list + 1] = entry
	end

	for _, node in pairs(spec.nodes) do
		local dist = node.pathDist or 1000
		local eligible = not node.alloc and node.modKey ~= "" and not granted[node.id] and node.path
			and dist >= 1 and node.type ~= "ClassStart" and node.type ~= "AscendClassStart" and node.type ~= "Socket"
		if eligible and node.ascendancyName then
			-- Ascendancy notables for the character's own ascendancy, within its free points.
			if node.type == "Notable" and node.ascendancyName == spec.curAscendClassName and dist <= 8 - ascUsed then
				local nodes, via = pathTo(node)
				add(candidates, { id = node.id, kind = "ascendancy", name = node.dn, lines = nodeLines(node), points = dist, via = via },
					{ addNodes = nodes })
			end
		elseif eligible and node.type == "Mastery" then
			if dist == 1 then
				for _, effect in ipairs(freeMasteryEffects(node)) do
					local effectNode = masteryEffectNode(node, effect)
					add(candidates, { id = node.id, kind = "mastery", name = node.dn, lines = nodeLines(effectNode), points = 1 },
						{ addNodes = { [effectNode] = true } })
				end
			end
		elseif eligible and (dist == 1 or ((node.type == "Notable" or node.type == "Keystone") and dist <= MAX_NOTABLE_DISTANCE)) then
			local kind = node.type == "Keystone" and "keystone" or node.type == "Notable" and "notable" or "small"
			if dist == 1 then
				-- Nodes with identical stats calculate identically.
				if not cache[node.modKey] then
					cache[node.modKey] = pick(calcFunc({ addNodes = { [node] = true } }), PASSIVE_KEYS)
				end
				candidates[#candidates + 1] = { id = node.id, kind = kind, name = node.dn, lines = nodeLines(node),
					points = 1, via = array({}), stats = cache[node.modKey] }
			else
				local nodes, via = pathTo(node)
				add(candidates, { id = node.id, kind = kind, name = node.dn, lines = nodeLines(node), points = dist, via = via },
					{ addNodes = nodes })
			end
		elseif node.alloc and node.type == "Mastery" and not granted[node.id] then
			-- Allocated mastery: every other effect it could take instead, for no points.
			local current = spec.masterySelections[node.id]
			for _, effect in ipairs(freeMasteryEffects(node)) do
				if effect.id ~= current then
					local effectNode = masteryEffectNode(node, effect)
					add(swaps, { id = node.id, kind = "swap", name = node.dn, lines = nodeLines(effectNode), points = 0,
						replaces = nodeLines(node) }, { addNodes = { [effectNode] = true }, removeNodes = { [node] = true } })
				end
			end
		end
	end

	local function order(a, b) return a.id < b.id or (a.id == b.id and (a.lines[1] or "") < (b.lines[1] or "")) end
	table.sort(candidates, order)
	table.sort(swaps, order)
	return {
		before = pick(calcBase, PASSIVE_KEYS),
		level = build.characterLevel,
		pointsUsed = used,
		extraPoints = build.calcsTab.mainOutput.ExtraPoints or 0,
		ascendancyUsed = ascUsed,
		candidates = candidates,
		masterySwaps = swaps,
	}
end

return api
