// Single source of truth for the engine version. Read by
// scripts/publish-engine.sh (grep) to drive the AR push tag and the
// gs://fh-engine/<version>/ upload path. Bump on every release.
package main

const Version = "0.1.0"
