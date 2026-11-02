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
--- trade site) in each slot it fits, as PoB's item tooltip compare does, with
--- the config in `mode` (see `modeChanges`).
local inMode -- defined with the analysis below
function api.tryItem(xmlText, itemText, mode)
	if xmlText ~= loadedXml then load(xmlText) end
	local item = new("Item", (itemText:gsub("\r\n", "\n"):gsub("^%s+", "")))
	if not item.base then
		error("Path of Building couldn't read that item. Copy it with Ctrl+C in game or from the trade site.", 0)
	end
	item:NormaliseQuality()
	return inMode(mode or "configured", function()
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
		return {
			item = item.name,
			requiredLevel = item.requirements and item.requirements.level or nil,
			before = numericStats(calcBase),
			slots = slots,
		}
	end)
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
			candidates[#candidates + 1] = { name = gemData.name, level = gem.level, stats = pick(out, SCORE_KEYS) }
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

--- The situational assumptions set in the build (`original` config input):
--- the changes that clear them and their labels.
local function conservativeChanges(original)
	local cleared, changes = {}, {}
	for _, opt in ipairs(assumptionOptions()) do
		local value = original[opt.var]
		if opt.type ~= "list" and value ~= nil and value ~= false and value ~= 0 and value ~= ""
			and value ~= opt.defaultState then
			changes[opt.var] = false
			cleared[#cleared + 1] = opt.type == "check" and optionLabel(opt)
				or (optionLabel(opt) .. ": " .. tostring(value))
		end
	end
	return changes, cleared
end

--- Config changes for a calculation mode: "configured" (the build as set),
--- "conservative" (situational assumptions cleared) or "boss" (cleared, and
--- the enemy an uber pinnacle boss).
local function modeChanges(original, mode)
	if mode == "conservative" or mode == "boss" then
		local changes = conservativeChanges(original)
		if mode == "boss" then changes.enemyIsBoss = "Uber" end
		return changes
	elseif mode == nil or mode == "configured" then
		return {}
	end
	error("Unknown calculation mode: " .. tostring(mode), 0)
end

--- Runs `fn` with the loaded build's config switched to `mode`, then restores
--- the build exactly, even when `fn` fails.
function inMode(mode, fn)
	local input = build.configTab.input
	local original = copyTable(input)
	local ok, result = pcall(function()
		local changes = modeChanges(original, mode)
		if next(changes) then withConfig(original, changes, function() end) end
		return fn(original)
	end)
	wipeTable(input)
	for k, v in pairs(original) do input[k] = v end
	recalc()
	if not ok then error(result, 0) end
	return result
end

--- Honest DPS, boss check, pantheon and support gem ranking for build XML.
--- Supports are ranked in `mode` (see `modeChanges`).
function api.analyse(xmlText, mode)
	if xmlText ~= loadedXml then load(xmlText) end
	return inMode("configured", function(original)
		local configured = numericStats(build.calcsTab.mainOutput)
		local changes, cleared = conservativeChanges(original)
		local conservative = withConfig(original, changes, numericStats)

		local bossOpt = findOption("enemyIsBoss")
		local bossNow = original.enemyIsBoss or bossOpt.list[bossOpt.defaultIndex].val
		local uber = withConfig(original, { enemyIsBoss = "Uber" }, numericStats)

		local major = rankPantheon(original, "pantheonMajorGod")
		local minor = rankPantheon(original, "pantheonMinorGod")

		withConfig(original, modeChanges(original, mode), function() end)
		local supports = rankSupports(40)

		return {
			configured = configured,
			conservative = conservative,
			cleared = cleared,
			enemyIsBoss = listLabel(bossOpt, bossNow),
			uber = uber,
			pantheonMajor = major,
			pantheonMinor = minor,
			supports = supports,
			mode = mode or "configured",
		}
	end)
end

local passivesNow

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
function api.passives(xmlText, mode)
	if xmlText ~= loadedXml then load(xmlText) end
	return inMode(mode, passivesNow)
end

passivesNow = function()
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
		-- Every allocated node's name (keystones, notables, ascendancy and timeless ones).
		allocated = (function()
			local names = array({})
			for _, node in pairs(build.spec.allocNodes) do
				if node.dn and node.type ~= "Normal" then names[#names + 1] = node.dn end
			end
			table.sort(names)
			return names
		end)(),
		candidates = candidates,
		masterySwaps = swaps,
	}
end

-- Item upgrade advisor (design doc §3.2): unique items tried in every slot
-- they fit, flask mods ranked, and PoB's weighted rare search per slot.

local ITEM_KEYS = { "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt" }
for _, key in ipairs(PASSIVE_KEYS) do ITEM_KEYS[#ITEM_KEYS + 1] = key end

--- Equipment slots of the active weapon set that hold or can hold an item.
local function activeSlots()
	local itemsTab = build.itemsTab
	local weaponSet = itemsTab.activeItemSet.useSecondWeaponSet and 2 or 1
	local slots = {}
	for slotName, slot in pairs(itemsTab.slots) do
		if not slot.inactive and (not slot.weaponSet or slot.weaponSet == weaponSet) and slot.shown() then
			slots[slotName] = slot
		end
	end
	return slots
end

local function linkCount(item)
	local best, run, group = 0, 0, nil
	for _, socket in ipairs(item and item.sockets or {}) do
		if socket.group == group then run = run + 1 else run, group = 1, socket.group end
		if run > best then best = run end
	end
	return best
end

--- PoB's unique items by title (a title can have several bases, e.g. Precursor's Emblem).
local uniquesByTitle
local function loadUniques()
	local guard = 0
	while main.uniqueDB.loading and guard < 10000 do
		runCallback("OnFrame")
		guard = guard + 1
	end
	if not uniquesByTitle then
		uniquesByTitle = {}
		for _, item in pairs(main.uniqueDB.list) do
			local title = item.title or item.name
			uniquesByTitle[title] = uniquesByTitle[title] or {}
			table.insert(uniquesByTitle[title], item)
		end
	end
	return uniquesByTitle
end

--- Cluster and timeless jewels change the tree; PoB's calculator alone can't place them.
local function triable(item)
	local base = item.baseName or ""
	return not item.clusterJewel and not base:match("Cluster Jewel") and not base:match("Timeless Jewel")
end

--- For each flask slot holding a non-unique flask: the build with the same
--- base and no mods (`plain`), and with each prefix and suffix alone (the best
--- tier the character's level allows, best roll).
local function rankFlasks(calcFunc, slots)
	local results = array({})
	local level = build.characterLevel
	for slotName, slot in pairs(slots) do
		local current = build.itemsTab.items[slot.selItemId]
		if slotName:match("^Flask") and current and current.type == "Flask" and current.rarity ~= "UNIQUE" and current.base then
			local function flask(prefix, suffix)
				local raw = "Rarity: MAGIC\n" .. current.baseName .. "\nCrafted: true\n"
					.. "Prefix: {range:1}" .. (prefix or "None") .. "\nSuffix: {range:1}" .. (suffix or "None") .. "\n"
					.. "Quality: " .. tostring(current.quality or 0)
				local item = new("Item", raw)
				item:Craft()
				return item
			end
			local plain = flask()
			-- Best tier per mod group the character's level allows.
			local best = {}
			for modId, mod in pairs(plain.affixes or {}) do
				if (mod.type == "Prefix" or mod.type == "Suffix") and (mod.level or 0) <= level
					and plain:GetModSpawnWeight(mod) > 0 then
					local key = mod.type .. ":" .. (mod.group or modId)
					if not best[key] or (best[key].mod.level or 0) < (mod.level or 0) then
						best[key] = { modId = modId, mod = mod }
					end
				end
			end
			local options = { Prefix = {}, Suffix = {} }
			for _, entry in pairs(best) do
				local item = entry.mod.type == "Prefix" and flask(entry.modId, nil) or flask(nil, entry.modId)
				local list = options[entry.mod.type]
				list[#list + 1] = { modId = entry.modId, lines = array({ unpack(entry.mod) }),
					stats = pick(calcFunc({ repSlotName = slotName, repItem = item }), SCORE_KEYS) }
			end
			local plainStats = pick(calcFunc({ repSlotName = slotName, repItem = plain }), SCORE_KEYS)
			local function sorted(list)
				table.sort(list, function(a, b) return a.modId < b.modId end)
				return array(list)
			end
			results[#results + 1] = {
				slot = slot.label or slotName,
				slotName = slotName,
				flask = current.name,
				active = slot.active and true or false,
				plain = plainStats,
				prefixes = sorted(options.Prefix),
				suffixes = sorted(options.Suffix),
			}
		end
	end
	table.sort(results, function(a, b) return a.slotName < b.slotName end)
	return results
end

--- Tries each named unique (PoB's unique database; names as the market lists
--- them) in every slot it fits, and ranks flask mods, in `mode`.
function api.upgrades(xmlText, mode, uniqueNames)
	if xmlText ~= loadedXml then load(xmlText) end
	local uniques = loadUniques()
	return inMode(mode, function()
		local itemsTab = build.itemsTab
		itemsTab:UpdateSockets()
		local calcFunc, calcBase = build.calcsTab:GetMiscCalculator()
		local slots = activeSlots()
		local current = array({})
		for slotName, slot in pairs(slots) do
			local item = itemsTab.items[slot.selItemId]
			current[#current + 1] = { slot = slot.label or slotName, slotName = slotName,
				item = item and item.name or nil, rarity = item and item.rarity or nil, links = linkCount(item) }
		end
		table.sort(current, function(a, b) return a.slotName < b.slotName end)

		local trials, missing = array({}), array({})
		local seen = {}
		if uniqueNames and uniqueNames[1] == "*" then
			-- Every unique PoB knows (dev tool: `--upgrades` in examples/stats.rs).
			uniqueNames = {}
			for name in pairs(uniques) do uniqueNames[#uniqueNames + 1] = name end
			table.sort(uniqueNames)
		end
		for _, name in ipairs(uniqueNames or {}) do
			if not uniques[name] then missing[#missing + 1] = name end
			for _, item in ipairs(not seen[name] and uniques[name] or {}) do
				seen[name] = true
				for slotName, slot in pairs(triable(item) and slots or {}) do
					local inSlot = itemsTab.items[slot.selItemId]
					-- A cluster or timeless jewel in the socket shapes the tree around it; keep it.
					if itemsTab:IsItemValidForSlot(item, slotName) and not (inSlot and inSlot.name == item.name)
						and not (inSlot and not triable(inSlot)) then
						trials[#trials + 1] = {
							name = item.title or item.name,
							base = item.baseName,
							slot = slot.label or slotName,
							slotName = slotName,
							replaces = inSlot and inSlot.name or nil,
							level = item.requirements and item.requirements.level or 0,
							stats = pick(calcFunc({ repSlotName = slotName, repItem = item }), ITEM_KEYS),
						}
					end
				end
			end
		end
		table.sort(trials, function(a, b) return a.name < b.name or (a.name == b.name and a.slotName < b.slotName) end)
		return {
			mode = mode or "configured",
			level = build.characterLevel,
			before = pick(calcBase, ITEM_KEYS),
			slots = current,
			uniques = trials,
			missing = missing,
			flasks = rankFlasks(calcFunc, slots),
		}
	end)
end

--- PoB's weighted trade search for a rare in `slotName` (its "Trader"): every
--- mod weighted by what it adds to `weights` ({ stat, weightMult } over PoB's
--- output), in `mode`. Returns the trade site query as JSON.
function api.rareSearch(xmlText, mode, slotName, weights)
	if xmlText ~= loadedXml then load(xmlText) end
	return inMode(mode, function()
		local slot = build.itemsTab.slots[slotName]
		if not slot then error("No slot called " .. tostring(slotName), 0) end
		local generator = new("TradeQueryGenerator", { itemsTab = build.itemsTab })
		generator.tradeTypeIndex = 2 -- instant buyout and in person
		local query, failure
		generator.requesterCallback = function(_, json, errMsg) query, failure = json, errMsg end
		local current = build.itemsTab.items[slot.selItemId]
		local statWeights = {}
		for i, w in ipairs(weights) do statWeights[i] = { stat = w.stat, weightMult = w.weightMult } end
		generator:StartQuery(slot, {
			statWeights = statWeights,
			influence1 = 1,
			influence2 = 1,
			jewelType = current and current.base and current.base.subType == "Abyss" and "Abyss" or "Base",
			includeCorrupted = false,
			includeMirrored = false,
			maxLevel = build.characterLevel,
		})
		local guard = 0
		while generator.calcContext.co and guard < 100000 do
			generator:OnFrame()
			guard = guard + 1
		end
		if failure then error(failure, 0) end
		if not query then error("Path of Building could not make a trade search for " .. slotName, 0) end
		return { slot = slot.label or slotName, query = query }
	end)
end

-- Compare (design doc §3.0, §3.12 items 10–12, 16): the build against a
-- target build (a guide, a ladder character), piece by piece.

--- Stats kept for each item swap: what the app ranks and checks for drawbacks.
local SWAP_KEYS = { "CombinedDPS", "TotalEHP", "Life", "EnergyShield", "Mana",
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	"PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken",
	"ChaosMaximumHitTaken", "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt" }

--- The main skill, the part of it calculated ("No Flask", "Life"…) and that part's number.
local function skillInfo()
	local ok, info = pcall(function()
		local skill = build.calcsTab.mainEnv.player.mainSkill
		return {
			name = skill.activeEffect.grantedEffect.name,
			part = skill.skillPartName,
			partIndex = skill.activeEffect.srcInstance and skill.activeEffect.srcInstance.skillPart,
		}
	end)
	return ok and info or {}
end

--- Calculates the loaded build's main skill in another part, as PoB's skill part
--- dropdown does. The loaded build no longer matches its XML afterwards.
local function setSkillPart(part)
	-- A missing part comes from Rust as JSON null (a light userdata, which is truthy).
	if type(part) ~= "number" then return end
	local ok, src = pcall(function() return build.calcsTab.mainEnv.player.mainSkill.activeEffect.srcInstance end)
	if ok and src and src.skillPart ~= part then
		src.skillPart = part
		loadedXml = nil
		recalc()
	end
end

--- The items in the loaded build's active gear slots, by PoB slot name. Jewel
--- sockets are left out: they belong to the tree, and the app swaps them with it.
local function heldItems()
	local out = {}
	for slotName, slot in pairs(activeSlots()) do
		local item = build.itemsTab.items[slot.selItemId]
		if item and not slot.nodeId and not slotName:find("Abyssal") then
			out[slotName] = { slot = slot.label or slotName, name = item.name, rarity = item.rarity, raw = item:BuildRaw() }
		end
	end
	return out
end

--- The loaded build's config options that are set, by var: PoB's label and the value as shown.
local function configValues()
	local out = {}
	for var, value in pairs(build.configTab.input) do
		local opt = findOption(var)
		if opt and opt.label then
			out[var] = { label = optionLabel(opt), value = opt.list and listLabel(opt, value) or tostring(value) }
		end
	end
	return out
end

--- The loaded build's stats with each of `items` (slot name → held item) in that slot.
local function trySlots(items)
	build.itemsTab:UpdateSockets()
	local calcFunc = build.calcsTab:GetMiscCalculator()
	local slots = activeSlots()
	local out = {}
	for slotName, held in pairs(items) do
		if slots[slotName] then
			local item = new("Item", held.raw)
			if item.base and build.itemsTab:IsItemValidForSlot(item, slotName) then
				out[slotName] = pick(calcFunc({ repSlotName = slotName, repItem = item }), SWAP_KEYS)
			end
		end
	end
	return out
end

--- PoB's numbers for build XML in `mode`, with the main skill in part `skillPart` if given.
function api.calculate(xmlText, mode, skillPart)
	if xmlText ~= loadedXml then load(xmlText) end
	setSkillPart(skillPart)
	return inMode(mode, function()
		return { stats = numericStats(build.calcsTab.mainOutput), skill = skillInfo() }
	end)
end

--- My build against a target build in `mode` (the target's main skill in part
--- `targetSkillPart` if given, to compare like with like): both builds' numbers,
--- each slot's items swapped both ways (the target's item in my build, mine in
--- the target), and the config options that differ.
function api.compare(myXml, targetXml, mode, targetSkillPart)
	local function loadTarget()
		load(targetXml)
		setSkillPart(targetSkillPart)
	end
	loadTarget()
	local target = inMode(mode, function()
		return { stats = numericStats(build.calcsTab.mainOutput), skill = skillInfo(), items = heldItems(), config = configValues() }
	end)
	load(myXml)
	local mine = inMode(mode, function()
		return {
			stats = numericStats(build.calcsTab.mainOutput),
			skill = skillInfo(),
			items = heldItems(),
			config = configValues(),
			withTheirs = trySlots(target.items),
		}
	end)
	loadTarget()
	local withMine = inMode(mode, function() return trySlots(mine.items) end)

	local slots = array({})
	local names = {}
	for name in pairs(target.items) do names[#names + 1] = name end
	for name in pairs(mine.items) do
		if not target.items[name] then names[#names + 1] = name end
	end
	table.sort(names)
	for _, name in ipairs(names) do
		local m, t = mine.items[name], target.items[name]
		slots[#slots + 1] = {
			slot = (t or m).slot,
			mine = m and { name = m.name, rarity = m.rarity, raw = m.raw } or nil,
			target = t and { name = t.name, rarity = t.rarity, raw = t.raw } or nil,
			intoMine = mine.withTheirs[name],
			intoTarget = withMine[name],
		}
	end

	local config = array({})
	local vars = {}
	for var in pairs(mine.config) do vars[var] = true end
	for var in pairs(target.config) do vars[var] = true end
	local sorted = {}
	for var in pairs(vars) do sorted[#sorted + 1] = var end
	table.sort(sorted)
	for _, var in ipairs(sorted) do
		local m, t = mine.config[var], target.config[var]
		if not (m and t and m.value == t.value) then
			config[#config + 1] = { var = var, label = (m or t).label, mine = m and m.value or nil, target = t and t.value or nil }
		end
	end

	return {
		mode = mode,
		mine = { stats = mine.stats, skill = mine.skill },
		target = { stats = target.stats, skill = target.skill },
		slots = slots,
		config = config,
	}
end

-- Build audit (design doc §3.12 items 13, 15, 18, 20): charges, conditions and
-- stances the config sets, what each flask is worth, and PoB's own warnings.

--- Config options the audit tries: charges, buffs and conditions a build often
--- assumes, and the stance.
local AUDIT_VARS = { "usePowerCharges", "useFrenzyCharges", "useEnduranceCharges", "buffOnslaught",
	"buffArcaneSurge", "buffUnholyMight", "buffFortification", "buffTailwind", "buffElusive",
	"conditionKilledRecently", "bloodSandStance" }

--- Utility flask bases tried in each flask slot.
local AUDIT_FLASKS = { "Silver Flask", "Sulphur Flask", "Diamond Flask", "Jade Flask", "Granite Flask",
	"Quartz Flask", "Quicksilver Flask", "Bismuth Flask", "Amethyst Flask", "Ruby Flask", "Sapphire Flask",
	"Topaz Flask", "Basalt Flask", "Aquamarine Flask", "Stibnite Flask", "Gold Flask" }

local AUDIT_KEYS = { "CombinedDPS", "TotalEHP", "Life", "Mana", "ManaUnreserved",
	"PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken",
	"ChaosMaximumHitTaken" }

local displayStats = LoadModule("Modules/BuildDisplayStats")

local function optionShown(var)
	local ctrl = build.configTab.varControls[var]
	if not ctrl then return false end
	local ok, shown = pcall(function() return ctrl:IsShown() end)
	return not ok or shown
end

--- What the build has that could make a charge or condition true: item and
--- passive lines and enabled gem names (the app matches them by text).
local function buildText()
	local items = array({})
	for slotName, slot in pairs(activeSlots()) do
		local item = build.itemsTab.items[slot.selItemId]
		if item then
			items[#items + 1] = { slot = slot.label or slotName, name = item.name, raw = item:BuildRaw() }
		end
	end
	local nodes = array({})
	for _, node in pairs(build.spec.allocNodes) do
		for _, line in ipairs(node.sd or {}) do nodes[#nodes + 1] = line end
	end
	local gems = array({})
	for _, group in ipairs(build.skillsTab.socketGroupList) do
		if group.enabled ~= false then
			for _, gem in ipairs(group.gemList or {}) do
				local name = gem.grantedEffect and gem.grantedEffect.name or gem.nameSpec
				if name and gem.enabled ~= false then gems[#gems + 1] = name end
			end
		end
	end
	return { items = items, nodes = nodes, gems = gems }
end

--- PoB's own warnings on the main output (e.g. "Poison DPS exceeds in game limit").
local function pobWarnings(output)
	local out = array({})
	for _, stat in ipairs(displayStats) do
		local value = stat.stat and output[stat.stat]
		-- PoB shows a stat (and so its warning) only when its condFunc holds.
		local shown = value ~= nil and (not stat.condFunc or select(2, pcall(stat.condFunc, value, output)) == true)
		if shown and stat.warnFunc then
			local ok, text = pcall(stat.warnFunc, value, output)
			if ok and text then out[#out + 1] = { stat = stat.stat, text = text } end
		end
	end
	return out
end

--- The audit of build XML: each of AUDIT_VARS that applies to the build, with
--- the stats for every value tried; each flask's worth (the build without it)
--- and each utility base tried in its slot; PoB's warnings; the build's text.
function api.audit(xmlText)
	if xmlText ~= loadedXml then load(xmlText) end
	return inMode("configured", function(original)
		local base = pick(build.calcsTab.mainOutput, AUDIT_KEYS)
		local warnings = pobWarnings(build.calcsTab.mainOutput)
		local options = array({})
		for _, var in ipairs(AUDIT_VARS) do
			local opt = findOption(var)
			if opt and optionShown(var) then
				local current = original[var]
				-- An unset list option is PoB's default entry (e.g. Blood Stance).
				if current == nil and opt.type == "list" and opt.list then current = opt.list[opt.defaultIndex or 1].val end
				local tries = array({})
				if opt.type == "check" then
					local flipped = not current
					tries[1] = { value = tostring(flipped), stats = withConfig(original, { [var] = flipped or false },
						function(out) return pick(out, AUDIT_KEYS) end) }
				elseif opt.type == "list" then
					for _, entry in ipairs(opt.list or {}) do
						if entry.val ~= current then
							tries[#tries + 1] = { value = entry.label, stats = withConfig(original, { [var] = entry.val },
								function(out) return pick(out, AUDIT_KEYS) end) }
						end
					end
				end
				options[#options + 1] = {
					var = var,
					label = optionLabel(opt),
					kind = opt.type,
					current = opt.type == "list" and listLabel(opt, current) or tostring(current == true),
					tries = tries,
				}
			end
		end
		withConfig(original, {}, function() end)

		build.itemsTab:UpdateSockets()
		local calcFunc = build.calcsTab:GetMiscCalculator()
		local flasks = array({})
		for slotName, slot in pairs(activeSlots()) do
			local item = build.itemsTab.items[slot.selItemId]
			if slotName:match("^Flask") and item and item.type == "Flask" then
				local alternatives = array({})
				if slot.active then
					for _, baseName in ipairs(AUDIT_FLASKS) do
						local alt = new("Item", "Rarity: NORMAL\n" .. baseName .. "\nQuality: 20")
						if alt.base then
							alternatives[#alternatives + 1] = { base = baseName,
								stats = pick(calcFunc({ repSlotName = slotName, repItem = alt }), AUDIT_KEYS) }
						end
					end
				end
				flasks[#flasks + 1] = {
					slot = slot.label or slotName,
					name = item.name,
					base = item.baseName,
					kind = item.base and item.base.subType or "",
					active = slot.active and true or false,
					raw = item:BuildRaw(),
					without = slot.active and pick(calcFunc({ toggleFlask = item }), AUDIT_KEYS) or nil,
					alternatives = alternatives,
				}
			end
		end
		table.sort(flasks, function(a, b) return a.slot < b.slot end)

		return {
			before = base,
			skill = skillInfo(),
			options = options,
			flasks = flasks,
			warnings = warnings,
			dotCap = data.misc.DotDpsCap,
			text = buildText(),
		}
	end)
end

return api
