local ids = redis.call("ZRANGE", "mediablast.jobs;", 0, -1)
local results = {}
for i, id in ipairs(ids) do
  results[i] = redis.call("GET", "mediablast.job." .. id .. ";")
end
return results
