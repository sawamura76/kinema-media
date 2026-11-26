#!/bin/sh
# Run by rpm after the package's files are removed. The package puts its
# wrapper library in /usr/lib/skrin and its licence and notice in
# /usr/share/doc/skrin but does not own either folder itself, so they stayed
# behind empty. rmdir only removes an empty folder: on an upgrade the new
# version's files are already there and it does nothing.
rmdir /usr/lib/skrin 2>/dev/null || true
rmdir /usr/share/doc/skrin 2>/dev/null || true
exit 0
