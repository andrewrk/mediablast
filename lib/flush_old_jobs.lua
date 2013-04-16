local min = ARGV[1]
local max = ARGV[2]
local zKey = "mediablast.jobs;"
local ids = redis.call("ZRANGEBYSCORE", zKey, min, max)
for i, id in ipairs(ids) do
  redis.call("PUBLISH", "mediablast.delete;", id)
  redis.call("DEL", "mediablast.job." .. id .. ";")
end
redis.call("ZREMRANGEBYSCORE", zKey, min, max)
