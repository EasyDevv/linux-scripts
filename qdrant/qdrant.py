#!/usr/bin/env python3
"""
Qdrant CLI tool for managing project file embeddings with Ollama.
Refactored for performance, accuracy, and maintainability.
"""
import argparse
import configparser
import json
import fnmatch
import os
import socket
import re
import concurrent.futures
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple, Generator
import hashlib

# Optional imports for async functionality
try:
    import asyncio
    ASYNC_AVAILABLE = True
except ImportError:
    ASYNC_AVAILABLE = False
    asyncio = None

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    AIOHTTP_AVAILABLE = False
    aiohttp = None

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    psutil = None

# Configuration settings
# Qdrant settings
QDRANT_HOST = "127.0.0.1"
QDRANT_PORT = 6333
COLLECTION_NAME = "project_files"

# Ollama settings
OLLAMA_HOST = "127.0.0.1"
OLLAMA_MODEL = "nomic-embed-text:latest"

# Indexing settings
BATCH_SIZE = 64
TEXT_LIMIT = 8000
FILE_SIZE_LIMIT_MB = 2
RERANK_SCORE_WEIGHT = 0.8
RERANK_PAYLOAD_WEIGHT = 0.2
MAX_MEMORY_USAGE_PERCENT = 50  # Maximum memory usage percentage

# Search settings
INITIAL_LIMIT = 25
FINAL_LIMIT = 10
MIN_SCORE = 0.45

# File weight configuration using wildcard patterns for human readability
# Patterns are processed in order - first match wins
# Format: (pattern, weight) where pattern can use wildcards like *.ts, */services/*, etc.

# Forced weight patterns - These always get the specified weight regardless of directory
# These patterns are matched against the full file path with wildcards
FORCED_WEIGHT_PATTERNS = {
    # Always low weight patterns - Most specific first
    0.05: [
        '*types.*',            # TypeScript type definition files (most specific)
        '*index.*',             # Index files of any type (more concise)
    ],
    0.1: [
        '.claude/*',           # Claude AI conversation files (lowest priority)
    ]
}

# Forced extension patterns - These always get the specified weight regardless of directory
FORCED_EXTENSION_PATTERNS = {
    # Always low weight patterns
    0.05: [
        '*.d.ts',               # TypeScript declaration files
        '*.lock',               # Lock files
        '*.log',                # Log files
        '*.DS_Store',           # macOS system files
        '*.tmp',                # Temporary files
        '*.temp',               # Temporary files
        '*.bak',                # Backup files
    ]
}

# Directory patterns - Weight applied based on directory location
DIRECTORY_WEIGHT_PATTERNS = {
    1.5: [
        '*/components/*',       # Component directories
        '*/services/*',         # Service directories
    ],
    1.4: [
        '*/modules/*',          # Module directories
        '*/lib/*',              # Library directories
    ],
    1.3: [
        '*/pages/*',            # Page directories
    ],
    0.4: [
        '*/test/*',             # Test directories
    ],
    0.3: [
        '*/scripts/*',         # Settings directories
    ],

    
}

# File extension patterns - Weight applied based on file extension
FILE_EXTENSION_WEIGHT_PATTERNS = {
    1.3: [
        '*.ts',                 # TypeScript files
        '*.js',                 # JavaScript files
        '*.svelte',             # Svelte component files
        '*.astro',              # Astro page files
    ],
    0.8: [
        '*.md',                 # Markdown documentation
        '*.markdown',           # Markdown documentation
        '*.mdx',                # MDX documentation
    ],
    0.3: [
        '*.json',               # JSON config files
        '*.jsonc',              # JSON with comments
        '*.yaml',               # YAML config files
        '*.yml',                # YAML config files
        '*.toml',               # TOML config files
        '*.ini',                # INI config files
        '*.cfg',                # Configuration files
        '*.conf',               # Configuration files
        '*.xml',                # XML config files
        '*.properties',         # Properties files
        '*.env',                # Environment files
    ],
}

# Test file patterns
TEST_FILE_PATTERNS = {
    0.4: [
        '*_test.*',             # Test files with _test suffix
        '*.test.*',             # Test files with .test. infix
    ],
}

# Combine all patterns into a single list with weights
# Order matters: forced patterns first, then directory, then file extensions, then test files
FILE_WEIGHT_PATTERNS = []

# Add forced weight patterns first (highest priority)
for weight, patterns in FORCED_WEIGHT_PATTERNS.items():
    FILE_WEIGHT_PATTERNS.extend([(pattern, weight) for pattern in patterns])

# Add forced extension patterns
for weight, patterns in FORCED_EXTENSION_PATTERNS.items():
    FILE_WEIGHT_PATTERNS.extend([(pattern, weight) for pattern in patterns])

# Add directory patterns
for weight, patterns in DIRECTORY_WEIGHT_PATTERNS.items():
    FILE_WEIGHT_PATTERNS.extend([(pattern, weight) for pattern in patterns])

# Add file extension patterns
for weight, patterns in FILE_EXTENSION_WEIGHT_PATTERNS.items():
    FILE_WEIGHT_PATTERNS.extend([(pattern, weight) for pattern in patterns])

# Add test file patterns
for weight, patterns in TEST_FILE_PATTERNS.items():
    FILE_WEIGHT_PATTERNS.extend([(pattern, weight) for pattern in patterns])

def _compile_wildcard_pattern(pattern: str):
    """Convert wildcard pattern to regex pattern."""
    # Escape special regex characters except * and ?
    escaped = re.escape(pattern)
    # Convert wildcards to regex
    regex_pattern = escaped.replace(r'\*', '.*').replace(r'\?', '.')

    # For file extension patterns, match files ending with extension
    if pattern.startswith('*') and '.' in pattern and '/' not in pattern:
        # Pattern like *types.ts - match filename ending with this pattern
        return re.compile(f'{regex_pattern.split("/")[-1]}$', re.IGNORECASE)
    elif pattern.startswith('*.'):
        return re.compile(f'{regex_pattern}$', re.IGNORECASE)
    # Match anywhere in the path for directory patterns
    elif '*/' in pattern:
        return re.compile(regex_pattern, re.IGNORECASE)
    # Match full path for simple patterns
    else:
        return re.compile(f'^{regex_pattern}$', re.IGNORECASE)

# Compile all patterns for performance
COMPILED_WEIGHT_PATTERNS = [
    (_compile_wildcard_pattern(pattern), weight)
    for pattern, weight in FILE_WEIGHT_PATTERNS
]

DEFAULT_WEIGHT = 1.0

import ollama
from qdrant_client import QdrantClient, models
from tqdm import tqdm

# --- Configuration Loader ---
class ConfigManager:
    """Uses the predefined configuration constants."""
    def __init__(self, config_file=None):
        self.config = {
            'qdrant': {'host': QDRANT_HOST, 'port': QDRANT_PORT},
            'ollama': {'host': OLLAMA_HOST, 'model': OLLAMA_MODEL},
            'indexing': {
                'batch_size': BATCH_SIZE,
                'text_limit': TEXT_LIMIT,
                'file_size_limit_mb': FILE_SIZE_LIMIT_MB,
                'rerank_score_weight': RERANK_SCORE_WEIGHT,
                'rerank_payload_weight': RERANK_PAYLOAD_WEIGHT,
                'max_memory_usage_percent': MAX_MEMORY_USAGE_PERCENT
            },
            'search': {
                'initial_limit': INITIAL_LIMIT,
                'final_limit': FINAL_LIMIT,
                'min_score': MIN_SCORE
            }
        }

    def get(self, section, key, fallback=None):
        return self.config.get(section, {}).get(key, fallback)

    def getint(self, section, key, fallback=None):
        value = self.get(section, key, fallback)
        if isinstance(value, str) and value.isdigit():
            return int(value)
        return value

    def getfloat(self, section, key, fallback=None):
        value = self.get(section, key, fallback)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                pass
        return value

# --- File Processing Logic ---
class FileProcessor:
    # Pre-defined exclude patterns using wildcards
    EXCLUDE_PATTERNS = [
        ".git",                 # Git directory
        "node_modules",         # Node modules
        "dist",                 # Distribution directories
        "build",                # Build directories
        "target",               # Target directories
        ".venv",                # Python virtual environments
        "venv",                 # Python virtual environments
        ".env",                 # Environment files
        ".env.local",           # Local environment files
        ".env.example",         # Example environment files
        "__pycache__",          # Python cache
        ".pytest_cache",        # Pytest cache
        ".vscode",              # VS Code settings
        ".idea",                # IntelliJ IDEA settings
        ".moon",                # Moon configuration
        "*test-result*",        # Test result files
        ".astro",               # Astro cache
        "temp",                 # Temporary directories
        ".rules",               # Rules directories
        ".repomix",             # Repomix directories
        "archive",              # Archive directories
        "AGENTS.md",            # Agents file
        "CLAUDE.md",            # Claude file
        "qdrant_agent.py",      # Qdrant agent file
        "package-lock.json",    # Package lock files
        "yarn.lock",            # Yarn lock files
        "bun.lock",             # Bun lock files
        "pnpm-lock.yaml",       # PNPM lock files
        "*.log",                # Log files
        "*.tmp",                # Temporary files
        "*.temp",               # Temporary files
        "*.bak"                 # Backup files
    ]

    # Pre-compile exclude patterns for performance
    _COMPILED_EXCLUDE_PATTERNS = [
        _compile_wildcard_pattern(pattern) for pattern in EXCLUDE_PATTERNS
    ]

    INCLUDED_EXTENSIONS = {
        ".js", ".ts", ".astro", ".svelte", ".md", ".mdx"
    }

    # Pre-compile include extension pattern
    _INCLUDE_REGEX = re.compile(r'\.(js|ts|astro|svelte|md|mdx)$', re.IGNORECASE)

    @staticmethod
    def get_files(directory: str) -> List[str]:
        """Return filtered list of files to index."""
        result, base = [], os.path.abspath(directory)

        for root, dirs, files in os.walk(base):
            # Fast directory filtering with pre-compiled wildcard patterns
            dirs[:] = [d for d in dirs if not any(pattern.fullmatch(d) for pattern in FileProcessor._COMPILED_EXCLUDE_PATTERNS)]

            for f in files:
                # Check filename against exclude patterns
                if any(pattern.fullmatch(f) for pattern in FileProcessor._COMPILED_EXCLUDE_PATTERNS):
                    continue

                full_path = os.path.relpath(os.path.join(root, f), base)
                # Check full path against exclude patterns
                if any(pattern.search(full_path) for pattern in FileProcessor._COMPILED_EXCLUDE_PATTERNS):
                    continue

                # Fast extension check with pre-compiled regex
                if not FileProcessor._INCLUDE_REGEX.search(f):
                    continue

                result.append(full_path)
        return result

    @staticmethod
    def preprocess_file_content(file_path: str, text: str) -> str | None:
        """Preprocesses file content into meaningful text for embedding."""
        if not text.strip():
            return None

        file_ext = Path(file_path).suffix.lower()
        lines = text.split('\n')

        # For Svelte components: preserve script and meaningful template content
        if file_ext == '.svelte':
            implementation_lines = []
            in_script = False
            in_style = False
            for line in lines:
                stripped = line.strip()
                # Skip empty lines
                if not stripped:
                    continue
                # Track script tags and their content
                if stripped.startswith('<script'):
                    in_script = True
                    implementation_lines.append(stripped)
                    continue
                elif stripped.startswith('</script>'):
                    in_script = False
                    implementation_lines.append(stripped)
                    continue
                # Track style tags
                elif stripped.startswith('<style'):
                    in_style = True
                    continue
                elif stripped.startswith('</style>'):
                    in_style = False
                    continue
                # In script tag: preserve all content
                if in_script:
                    implementation_lines.append(stripped)
                # In template: preserve meaningful content
                elif not in_style and not stripped.startswith(('<!--', '-->')):
                    # Include props definitions, event handlers, and meaningful content
                    if any(keyword in stripped for keyword in ['props', '$props', 'on:', 'bind:', 'class:', 'id=', 'type=', 'placeholder=']):
                        implementation_lines.append(stripped)
                    # Include text content that's not just HTML structure
                    elif not stripped.startswith(('<', '>', '</', '/>')) or len(stripped) > 20:
                        implementation_lines.append(stripped)
            return '\n'.join(implementation_lines).strip() or None

        # For TypeScript/JavaScript: preserve imports and meaningful content
        elif file_ext in {'.ts', '.tsx', '.js', '.jsx'}:
            implementation_lines = []
            for line in lines:
                stripped = line.strip()
                # Skip empty lines and purely structural
                if not stripped:
                    continue
                # Skip simple JSON-like structures
                if stripped.startswith(('{', '}', '[', ']')) and len(stripped) < 10:
                    continue
                # Skip comment lines that don't add value
                if stripped.startswith(('/*', '*', '*/', '//', '#')):
                    continue
                # Preserve important imports with context
                if stripped.startswith(('import ', 'export ')):
                    # Include all imports except basic type-only imports
                    if not (stripped.startswith('import type ') and ' from ' in stripped and ('.d.ts' in stripped or stripped.endswith(';'))):
                        implementation_lines.append(stripped)
                else:
                    implementation_lines.append(stripped)
            return '\n'.join(implementation_lines).strip() or None

        # For Astro files: prioritize frontmatter and meaningful content
        elif file_ext == '.astro':
            implementation_lines = []
            in_frontmatter = False
            for line in lines:
                stripped = line.strip()
                # Check for frontmatter delimiters
                if stripped == '---':
                    if not in_frontmatter:
                        in_frontmatter = True
                        continue
                    else:
                        in_frontmatter = False
                        continue
                # In frontmatter: include all
                if in_frontmatter:
                    implementation_lines.append(stripped)
                # Outside frontmatter: skip component-only lines
                elif not stripped.startswith(('<', '>', '</', '/>')) and len(stripped) > 5:
                    implementation_lines.append(stripped)
            return '\n'.join(implementation_lines).strip() or None

        # For Python and other languages: filter out boilerplate
        elif file_ext in {'.py', '.go', '.rs'}:
            meaningful_lines = [
                line for line in lines
                if line.strip() and not line.strip().startswith(('}', '{', '[', ']', '(', ')', '`', '#', '"""', "'''"))
            ]
            return '\n'.join(meaningful_lines).strip() or None

        # For markup/config: remove comments and limit content
        elif file_ext in {'.md', '.markdown', '.yaml', '.yml', '.toml', '.json'}:
            content_lines = [
                line.strip() for line in lines
                if line.strip() and not line.strip().startswith(('#', '//'))
            ]
            return '\n'.join(content_lines[:100]).strip() or None

        # Default: return stripped text
        return text.strip()

    @staticmethod
    def get_file_weight(file_path: str) -> float:
        """Assigns a weight to a file based on its likely importance."""
        path = file_path.lower()

        # Check patterns in order - first match wins
        for pattern_regex, weight in COMPILED_WEIGHT_PATTERNS:
            if pattern_regex.search(path):
                return weight

        return DEFAULT_WEIGHT

# --- Abstraction for Vector Database and Embedding Services ---
class AsyncEmbeddingService:
    def __init__(self, host: str, model: str, max_concurrent: int = 10):
        self.host = host
        self.model = model
        self.max_concurrent = max_concurrent
        self.session = None
        self._connector = None

    async def __aenter__(self):
        self._connector = aiohttp.TCPConnector(
            limit=self.max_concurrent,
            ttl_dns_cache=300,
            use_dns_cache=True
        )
        self.session = aiohttp.ClientSession(
            connector=self._connector,
            timeout=aiohttp.ClientTimeout(total=30)
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
        if self._connector:
            await self._connector.close()

    async def get_embedding(self, text: str) -> List[float]:
        if not self.session:
            raise RuntimeError("Service must be used as async context manager")

        async with self.session.post(
            f"http://{self.host}:11434/api/embeddings",
            json={"model": self.model, "prompt": text}
        ) as response:
            if response.status == 200:
                data = await response.json()
                return data["embedding"]
            else:
                raise Exception(f"Embedding request failed: {response.status}")

    async def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        # Use semaphore to limit concurrent requests
        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def get_single_embedding(text: str) -> List[float]:
            async with semaphore:
                return await self.get_embedding(text)

        # Create all tasks and wait for them to complete
        tasks = [get_single_embedding(text) for text in texts]
        embeddings = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle exceptions
        valid_embeddings = []
        for embedding in embeddings:
            if isinstance(embedding, Exception):
                print(f"Warning: Embedding generation failed: {embedding}")
                # Return zero embedding for failed requests
                valid_embeddings.append([0.0] * 768)  # Default embedding size
            else:
                valid_embeddings.append(embedding)

        return valid_embeddings


class EmbeddingService:
    """Fallback synchronous service for backward compatibility"""
    def __init__(self, host: str, model: str):
        self.client = ollama.Client(host=host)
        self.model = model

    def get_embedding(self, text: str) -> List[float]:
        return self.client.embeddings(model=self.model, prompt=text)["embedding"]

    def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        return [self.client.embeddings(model=self.model, prompt=text)["embedding"] for text in texts]

class VectorDBService:
    def __init__(self, host: str, port: int):
        self.client = QdrantClient(host=host, port=port)

    def ensure_collection(self, name: str, vector_size: int):
        if not self.client.collection_exists(collection_name=name):
            self.client.create_collection(
                collection_name=name,
                vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE)
            )
            print(f"✅ Collection '{name}' created.")

    def upsert_points_batch(self, collection_name: str, points: List[models.PointStruct]):
        # Ensure no duplicates by deleting existing points with the same IDs
        if points:
            point_ids = [point.id for point in points]
            self.client.delete(
                collection_name=collection_name,
                points_selector=models.PointIdsList(points=point_ids),
                wait=False
            )
        self.client.upsert(collection_name=collection_name, points=points, wait=False)

    def search(self, collection_name: str, vector: List[float], limit: int) -> List[models.ScoredPoint]:
        if not self.client.collection_exists(collection_name):
            return []
        return self.client.query_points(
            collection_name=collection_name,
            query=vector,
            limit=limit
        ).points

    def get_collections(self):
        return self.client.get_collections()

    def delete_collection(self, name: str):
        self.client.delete_collection(collection_name=name)

# --- Main Application Logic ---
class SearchAgent:
    def __init__(self, config: ConfigManager, use_async: bool = True):
        self.config = config
        # Check if async functionality is available
        self.use_async = use_async and ASYNC_AVAILABLE and AIOHTTP_AVAILABLE

        if use_async and not ASYNC_AVAILABLE:
            print("⚠️  asyncio not available, using synchronous processing")
        elif use_async and not AIOHTTP_AVAILABLE:
            print("⚠️  aiohttp not available, using synchronous processing")

        self.vdb = VectorDBService(
            host=config.get('qdrant', 'host'),
            port=config.getint('qdrant', 'port')
        )

        if self.use_async:
            self.embedder = None  # Will be created in async context
            self.max_workers = min(32, (os.cpu_count() or 1) * 4)
        else:
            self.embedder = EmbeddingService(
                host=config.get('ollama', 'host'),
                model=config.get('ollama', 'model')
            )

    @staticmethod
    def _process_single_file(file_args: Tuple[str, str, int, int]) -> Optional[Dict]:
        """Process a single file for parallel execution."""
        file_path, directory, file_size_limit_bytes, text_limit = file_args

        try:
            full_path = Path(directory) / file_path
            if full_path.stat().st_size > file_size_limit_bytes:
                return None

            raw_text = full_path.read_text(errors="ignore")
            processed_text = FileProcessor.preprocess_file_content(file_path, raw_text)

            if not processed_text:
                return None

            # IMPORTANT: Embed only the pure, processed content
            text_to_embed = processed_text[:text_limit]

            payload = {
                "file_path": file_path,
                "weight": FileProcessor.get_file_weight(file_path),
                "original_size": len(raw_text),
                "processed_size": len(processed_text)
            }

            # The ID is a hash of the file path for consistency
            point_id = int(hashlib.md5(file_path.encode()).hexdigest()[:16], 16)

            return {
                "id": point_id,
                "text": text_to_embed,
                "payload": payload
            }
        except Exception:
            return None

    def get_dynamic_batch_size(self, avg_text_length: int = None) -> int:
        """Calculate optimal batch size based on system resources."""
        base_batch_size = self.config.getint('indexing', 'batch_size')

        # If psutil is not available, return base batch size
        if not PSUTIL_AVAILABLE:
            return base_batch_size

        max_memory_percent = self.config.getint('indexing', 'max_memory_usage_percent')

        # Get available memory
        available_memory = psutil.virtual_memory().available
        total_memory = psutil.virtual_memory().total
        memory_limit = (total_memory * max_memory_percent) / 100

        # Estimate memory per item (rough approximation)
        # Each embedding ~768 floats * 4 bytes + text + payload overhead
        memory_per_item = 768 * 4 + (avg_text_length or 1000) + 500

        # Calculate batch size based on available memory
        memory_limited_batch = int(memory_limit / memory_per_item)

        # Use the smaller of base batch size and memory-limited batch, with minimum of 16
        return min(base_batch_size, max(16, memory_limited_batch))

    async def index_project_async(self, directory: str, collection_name: str):
        """Indexes an entire project directory using async processing."""
        files = FileProcessor.get_files(directory)
        if not files:
            print("❌ No files found for indexing.")
            return

        print(f"📂 Found {len(files)} files to index into collection '{collection_name}'.")

        # Determine vector size from a sample embedding
        async with AsyncEmbeddingService(
            host=self.config.get('ollama', 'host'),
            model=self.config.get('ollama', 'model')
        ) as embedder:
            try:
                sample_embedding = await embedder.get_embedding("test")
                vector_size = len(sample_embedding)
                self.vdb.ensure_collection(collection_name, vector_size)
            except Exception as e:
                print(f"❌ Could not connect to Ollama to get vector size: {e}")
                return

            # Prepare arguments for parallel processing
            file_size_limit_bytes = self.config.getint('indexing', 'file_size_limit_mb') * 1024 * 1024
            text_limit = self.config.getint('indexing', 'text_limit')

            file_args = [(f, directory, file_size_limit_bytes, text_limit) for f in files]

            # Process files in parallel
            processed_points = []
            indexed_count = 0

            with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                print(f"\nProcessing files with {self.max_workers} workers...")

                # Submit all tasks
                future_to_file = {executor.submit(self._process_single_file, args): args[0] for args in file_args}

                # Collect results as they complete
                with tqdm(total=len(files), desc="Processing files") as pbar:
                    for future in concurrent.futures.as_completed(future_to_file):
                        result = future.result()
                        pbar.update(1)

                        if result:
                            processed_points.append(result)
                            indexed_count += 1

            if not processed_points:
                print("🤷 No content was processed for indexing.")
                return

            print(f"\nSuccessfully processed {indexed_count} files.")

            # Calculate dynamic batch size
            avg_text_length = sum(len(p["text"]) for p in processed_points) / len(processed_points)
            batch_size = self.get_dynamic_batch_size(int(avg_text_length))
            print(f"Using dynamic batch size: {batch_size}")

            # Process in streaming batches to save memory
            print("\nEmbedding and uploading documents in streaming batches...")

            for i in tqdm(range(0, len(processed_points), batch_size), desc="Indexing Batches"):
                batch = processed_points[i:i + batch_size]
                texts_in_batch = [item["text"] for item in batch]

                try:
                    # Get embeddings asynchronously
                    embeddings = await embedder.get_embeddings_batch(texts_in_batch)

                    # Create points for upsert
                    points = [
                        models.PointStruct(
                            id=item["id"],
                            vector=emb,
                            payload=item["payload"]
                        )
                        for item, emb in zip(batch, embeddings)
                    ]
                    self.vdb.upsert_points_batch(collection_name, points)

                except Exception as e:
                    print(f"\n❌ Error processing batch {i // batch_size + 1}: {e}")

        print(f"✅ Successfully indexed {indexed_count} files into '{collection_name}'.")

    def index_project(self, directory: str, collection_name: str):
        """Indexes an entire project directory in batches."""
        if self.use_async:
            # Run the async version in the event loop
            try:
                asyncio.run(self.index_project_async(directory, collection_name))
            except Exception as e:
                print(f"❌ Async indexing failed: {e}")
                # Fall back to sync version
                self.use_async = False
                self.embedder = EmbeddingService(
                    host=self.config.get('ollama', 'host'),
                    model=self.config.get('ollama', 'model')
                )
                self.index_project_sync(directory, collection_name)
        else:
            self.index_project_sync(directory, collection_name)

    def index_project_sync(self, directory: str, collection_name: str):
        """Synchronous fallback for indexing."""
        files = FileProcessor.get_files(directory)
        if not files:
            print("❌ No files found for indexing.")
            return

        print(f"📂 Found {len(files)} files to index into collection '{collection_name}'.")

        # Determine vector size from a sample embedding
        try:
            sample_embedding = self.embedder.get_embedding("test")
            vector_size = len(sample_embedding)
            self.vdb.ensure_collection(collection_name, vector_size)
        except Exception as e:
            print(f"❌ Could not connect to Ollama to get vector size: {e}")
            return

        batch_size = self.config.getint('indexing', 'batch_size')
        file_size_limit_bytes = self.config.getint('indexing', 'file_size_limit_mb') * 1024 * 1024
        text_limit = self.config.getint('indexing', 'text_limit')

        points_to_upsert = []
        indexed_count = 0

        for file_path in tqdm(files, desc="Processing files"):
            full_path = Path(directory) / file_path
            if full_path.stat().st_size > file_size_limit_bytes:
                continue

            try:
                raw_text = full_path.read_text(errors="ignore")
                processed_text = FileProcessor.preprocess_file_content(file_path, raw_text)

                if not processed_text:
                    continue

                # IMPORTANT: Embed only the pure, processed content
                text_to_embed = processed_text[:text_limit]

                # For service files, ensure we preserve more content
                if 'service' in file_path.lower() and processed_size < 200:
                    # Use the original text if processed is too small
                    text_to_embed = raw_text[:text_limit]

                payload = {
                    "file_path": file_path,
                    "weight": FileProcessor.get_file_weight(file_path),
                    "original_size": len(raw_text),
                    "processed_size": len(processed_text)
                }

                # The ID is a hash of the file path for consistency
                point_id = int(hashlib.md5(file_path.encode()).hexdigest()[:16], 16)

                points_to_upsert.append(
                    {"id": point_id, "text": text_to_embed, "payload": payload}
                )
                indexed_count += 1

            except Exception:
                continue # Skip files that can't be read

        if not points_to_upsert:
            print("🤷 No content was processed for indexing.")
            return

        print(f"\nEmbedding and uploading {len(points_to_upsert)} documents in batches...")

        # Batch embedding and upserting
        for i in tqdm(range(0, len(points_to_upsert), batch_size), desc="Indexing Batches"):
            batch = points_to_upsert[i:i + batch_size]
            texts_in_batch = [item["text"] for item in batch]

            try:
                embeddings = self.embedder.get_embeddings_batch(texts_in_batch)

                points = [
                    models.PointStruct(
                        id=item["id"],
                        vector=emb,
                        payload=item["payload"]
                    )
                    for item, emb in zip(batch, embeddings)
                ]
                self.vdb.upsert_points_batch(collection_name, points)

            except Exception as e:
                print(f"\n❌ Error processing batch {i // batch_size + 1}: {e}")

        print(f"✅ Successfully indexed {indexed_count} files into '{collection_name}'.")

    async def find_similar_async(self, query: str, collection_name: str):
        """Finds similar documents using vector search and re-ranking (async)."""
        # Query preprocessing can be added here (e.g., synonym expansion)

        async with AsyncEmbeddingService(
            host=self.config.get('ollama', 'host'),
            model=self.config.get('ollama', 'model')
        ) as embedder:
            try:
                query_vector = await embedder.get_embedding(query)
            except Exception as e:
                print(json.dumps({"error": f"Failed to get embedding for query: {e}"}, indent=2))
                return

            initial_limit = self.config.getint('search', 'initial_limit')
            initial_results = self.vdb.search(collection_name, query_vector, limit=initial_limit)

            if not initial_results:
                print(json.dumps({"query": query, "results": []}, indent=2))
                return

            # Re-ranking logic
            score_w = self.config.getfloat('indexing', 'rerank_score_weight')
            payload_w = self.config.getfloat('indexing', 'rerank_payload_weight')

            reranked_results = []
            for r in initial_results:
                reranked_score = (r.score * score_w) + (r.payload.get('weight', 1.0) * payload_w)
                reranked_results.append({"result": r, "reranked_score": reranked_score})

            # Sort by the new composite score
            reranked_results.sort(key=lambda x: x["reranked_score"], reverse=True)

            # Filter by minimum score and limit final results
            min_score = self.config.getfloat('search', 'min_score')
            final_limit = self.config.getint('search', 'final_limit')

            final_results = [
                item["result"] for item in reranked_results
                if item["result"].score >= min_score
            ][:final_limit]

            print(json.dumps({
                "query": query,
                "results": [
                    {"score": r.score, "payload": r.payload} for r in final_results
                ]
            }, indent=2))

    def find_similar(self, query: str, collection_name: str):
        """Finds similar documents using vector search and re-ranking."""
        if self.use_async:
            # Run the async version in the event loop
            try:
                asyncio.run(self.find_similar_async(query, collection_name))
            except Exception as e:
                print(f"❌ Async search failed: {e}")
                # Fall back to sync version
                self.use_async = False
                self.embedder = EmbeddingService(
                    host=self.config.get('ollama', 'host'),
                    model=self.config.get('ollama', 'model')
                )
                self.find_similar_sync(query, collection_name)
        else:
            self.find_similar_sync(query, collection_name)

    def find_similar_sync(self, query: str, collection_name: str):
        """Synchronous fallback for finding similar documents."""
        # Query preprocessing can be added here (e.g., synonym expansion)

        try:
            query_vector = self.embedder.get_embedding(query)
        except Exception as e:
            print(json.dumps({"error": f"Failed to get embedding for query: {e}"}, indent=2))
            return

        initial_limit = self.config.getint('search', 'initial_limit')
        initial_results = self.vdb.search(collection_name, query_vector, limit=initial_limit)

        if not initial_results:
            print(json.dumps({"query": query, "results": []}, indent=2))
            return

        # Re-ranking logic
        score_w = self.config.getfloat('indexing', 'rerank_score_weight')
        payload_w = self.config.getfloat('indexing', 'rerank_payload_weight')

        reranked_results = []
        for r in initial_results:
            reranked_score = (r.score * score_w) + (r.payload.get('weight', 1.0) * payload_w)
            reranked_results.append({"result": r, "reranked_score": reranked_score})

        # Sort by the new composite score
        reranked_results.sort(key=lambda x: x["reranked_score"], reverse=True)

        # Filter by minimum score and limit final results
        min_score = self.config.getfloat('search', 'min_score')
        final_limit = self.config.getint('search', 'final_limit')

        final_results = [
            item["result"] for item in reranked_results
            if item["result"].score >= min_score
        ][:final_limit]

        print(json.dumps({
            "query": query,
            "results": [
                {"score": r.score, "payload": r.payload} for r in final_results
            ]
        }, indent=2))

    def check_services(self):
        """Checks the status of Qdrant and Ollama services."""
        def is_port_open(host, port, timeout=1):
            try:
                with socket.create_connection((host, port), timeout):
                    return True
            except (socket.timeout, ConnectionRefusedError, OSError):
                return False

        # Check services concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            qdrant_future = executor.submit(
                is_port_open,
                self.config.get('qdrant', 'host'),
                self.config.getint('qdrant', 'port')
            )
            ollama_future = executor.submit(
                is_port_open,
                self.config.get('ollama', 'host'),
                11434
            )

            status = {
                "qdrant": "running" if qdrant_future.result() else "stopped",
                "ollama": "running" if ollama_future.result() else "stopped"
            }

        print(json.dumps({"services": status}, indent=2))
        
    def list_collections_with_details(self):
        """Lists all collections in Qdrant with their details."""
        try:
            collections = self.vdb.get_collections().collections
            if not collections:
                print(json.dumps({"collections": [], "message": "No collections found."}, indent=2))
                return

            details = [{"name": c.name} for c in collections]
            print(json.dumps({"collections": details}, indent=2))
        except Exception as e:
            print(json.dumps({"error": f"Failed to list collections: {e}"}, indent=2))

    def delete_collection(self, collection_name: str):
        """Deletes a specified collection from Qdrant."""
        try:
            # Check if collection exists before deleting
            collections = self.vdb.get_collections().collections
            existing_collections = [c.name for c in collections]

            if collection_name not in existing_collections:
                print(json.dumps({
                    "error": f"Collection '{collection_name}' not found.",
                    "existing_collections": existing_collections
                }, indent=2))
                return

            self.vdb.delete_collection(collection_name)
            print(json.dumps({
                "message": f"Collection '{collection_name}' deleted successfully.",
                "collection": collection_name
            }, indent=2))
        except Exception as e:
            print(json.dumps({"error": f"Failed to delete collection '{collection_name}': {e}"}, indent=2))

# --- CLI Interface ---
def main():
    parser = argparse.ArgumentParser(
        description="A CLI tool for semantic project search using Qdrant and Ollama.",
        formatter_class=argparse.RawTextHelpFormatter
    )

    # Main operations
    main_ops = parser.add_argument_group("Main Operations")
    main_ops.add_argument("--index", "-i", action="store_true", help="Index all files in the project directory.")
    main_ops.add_argument("--find", "-f", metavar="QUERY", help="Find similar files using a text query.")
    main_ops.add_argument("--delete", "-d", metavar="COLLECTION", help="Delete specified collection.")

    # Utility operations
    util_ops = parser.add_argument_group("Utility Operations")
    util_ops.add_argument("--status", action="store_true", help="Check Qdrant and Ollama service status.")
    util_ops.add_argument("--list", "-l", action="store_true", help="List all Qdrant collections.")
    util_ops.add_argument("--tree", action="store_true", help="Show files that would be indexed.")

    # Configuration
    config_ops = parser.add_argument_group("Configuration")
    config_ops.add_argument("--dir", default=".", help="Directory to process (default: current directory).")
    config_ops.add_argument("--collection", "-c", help="Collection name (default: directory name).")
    config_ops.add_argument("--sync", action="store_true", help="Use synchronous processing (fallback for compatibility).")
    config_ops.add_argument("--workers", type=int, default=0, help="Number of parallel workers (default: CPU cores * 4).")

    args = parser.parse_args()
    config = ConfigManager()

    # Check for async processing availability
    use_async = not args.sync

    # Create agent with appropriate settings
    agent = SearchAgent(config, use_async=use_async)

    # Configure workers if specified
    if args.workers > 0 and hasattr(agent, 'max_workers'):
        agent.max_workers = args.workers

    collection_name = args.collection or os.path.basename(os.path.abspath(args.dir))

    # Execute command
    if args.status:
        agent.check_services()
    elif args.list:
        agent.list_collections_with_details()
    elif args.delete:
        agent.delete_collection(args.delete)
    elif args.find:
        agent.find_similar(args.find, collection_name)
    elif args.index:
        agent.index_project(args.dir, collection_name)
    elif args.tree:
        files = FileProcessor.get_files(args.dir)
        if not files:
            print("❌ No files found for indexing.")
        else:
            print(f"📂 Found {len(files)} files scheduled for indexing:")
            for i, f in enumerate(files, 1):
                print(f"{i:3d}. {f}")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()