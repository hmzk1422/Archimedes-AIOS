"""Test script for hybrid search implementation."""
import os
import json
import urllib.parse
import requests
import re
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://vcqfplrdymwfisbekokp.supabase.co')
SUPABASE_KEY = os.getenv('SUPADB_API')

headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}

print("=== TEST 1: Corrected Keyword ILIKE search (with parentheses) ===")
query = "asia coverage limits medical"
keywords = re.findall(r'\b[a-zA-Z]{3,}\b', query.lower())
print(f"Keywords: {keywords}")

# CORRECT syntax: or=(content.ilike.*asia*,content.ilike.*coverage*)
keyword_conditions = f"({','.join([f'content.ilike.*{kw}*' for kw in keywords])})"
query_url = f"{SUPABASE_URL}/rest/v1/documents?select=id,content,metadata&or={urllib.parse.quote(keyword_conditions)}&limit=5&metadata->>datatype.eq.policies"
print(f"URL: {query_url}\n")

r = requests.get(query_url, headers=headers, timeout=15)
print(f"Status: {r.status_code}")
if r.status_code == 200:
    docs = r.json()
    print(f"Results: {len(docs)}")
    for d in docs[:5]:
        md = d.get('metadata', {})
        if isinstance(md, str):
            md = json.loads(md)
        src = md.get('source', '?')
        content = str(d.get('content', ''))[:120]
        print(f"  source={src} content={content}")
else:
    print(f"Error: {r.text[:500]}")

print("\n=== TEST 2: Check all sources in DB ===")
r2 = requests.get(f'{SUPABASE_URL}/rest/v1/documents?select=id,content,metadata&limit=100', headers=headers, timeout=15)
if r2.status_code == 200:
    docs = r2.json()
    sources = set()
    for d in docs:
        md = d.get('metadata', {})
        if isinstance(md, str): md = json.loads(md)
        src = md.get('source', '')
        if src: sources.add(src)
    print(f"All sources ({len(sources)}): {sorted(sources)}")

print("\n=== TEST 3: Test with tenant_id filter ===")
tenant_id = "e5900f75-fad2-44fb-bf34-0aea3793c6ae"
query_url2 = f"{SUPABASE_URL}/rest/v1/documents?select=id,content,metadata&or={urllib.parse.quote(keyword_conditions)}&limit=5&metadata->>datatype.eq.policies&metadata->>tenant_id.eq.{tenant_id}"
r3 = requests.get(query_url2, headers=headers, timeout=15)
print(f"Status: {r3.status_code}")
if r3.status_code == 200:
    docs = r3.json()
    print(f"Results: {len(docs)}")
    for d in docs[:3]:
        md = d.get('metadata', {})
        if isinstance(md, str): md = json.loads(md)
        print(f"  source={md.get('source')} tenant={md.get('tenant_id')}")
else:
    print(f"Error: {r3.text[:500]}")

print("\n=== ALL TESTS COMPLETE ===")