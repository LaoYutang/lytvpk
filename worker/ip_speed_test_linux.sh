#!/bin/bash
# test_steam_ips.sh

TARGET_URL="https://cdn.steamusercontent.com/ugc/1852675168601248369/F20C8BCDE3535FB6415810D1B0A3BD7B404E4346/"
HOSTNAME="cdn.steamusercontent.com"

IPS=(

)

echo "Testing IPs from this server..."
echo ""

declare -A results

for ip in "${IPS[@]}"; do
  # TCP latency
  latency=$(bash -c "time (echo >/dev/tcp/$ip/443) 2>&1" 2>/dev/null | grep real | awk '{print $2}')
  
  # Download speed (first 5MB)
  speed=$(curl -s -k -o /dev/null \
    -r 0-5242880 \
    --resolve "${HOSTNAME}:443:${ip}" \
    -w "%{speed_download}" \
    --connect-timeout 5 \
    --max-time 20 \
    "$TARGET_URL")
  
  speed_mb=$(echo "scale=2; $speed / 1048576" | bc)
  echo "IP: $ip | Latency: ${latency} | Speed: ${speed_mb} MB/s"
  results[$ip]=$speed
done

echo ""
echo "--- Sorted by speed ---"
for ip in "${!results[@]}"; do
  echo "${results[$ip]} $ip"
done | sort -rn | while read -r speed ip; do
  echo "$(echo "scale=2; $speed / 1048576" | bc) MB/s  ->  $ip"
done