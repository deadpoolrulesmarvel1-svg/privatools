"""Every `npm ci` in CI and in the image skips onnxruntime-node's CUDA download.

onnxruntime-node, which @huggingface/transformers depends on, downloads its
CUDA binaries from NuGet on any Linux x64 install unless ONNXRUNTIME_NODE_INSTALL
is "skip". Nothing here has a GPU, and that download timing out failed the
v2.7.24 release gate (2026-10-04).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NPM_CI = re.compile(r"(?m)^(?!\s*#).*\bnpm ci\b")


def test_every_workflow_that_runs_npm_ci_skips_the_cuda_download():
    installing = []
    for workflow in sorted((ROOT / ".github/workflows").glob("*.yml")):
        text = workflow.read_text()
        if not NPM_CI.search(text):
            continue
        installing.append(workflow.name)
        assert re.search(r"(?m)^env:\n(?:[ ]{2}.*\n)*?[ ]{2}ONNXRUNTIME_NODE_INSTALL: skip$", text), workflow.name
    assert installing, "no workflow runs npm ci, so this check checks nothing"


def test_the_image_skips_the_cuda_download():
    assert re.search(r"(?m)^RUN ONNXRUNTIME_NODE_INSTALL=skip npm ci$", (ROOT / "Dockerfile").read_text())
