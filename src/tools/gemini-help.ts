import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';

const HELP_TOPICS: Record<string, string> = {
  overview: `# Gemini MCP Server - Overview

**Version:** 2.1.0
**Tools Available:** 10

## Core Features
• **Chat & Research:** gemini_chat, gemini_deep_research
• **Agents:** gemini_agent, gemini_agent_models
• **Documents:** ocr, generate_summary, transcribe, extract_structured_data
• **Image Generation:** generate_image, edit_image
• **Image Analysis:** describe_image, analyze_image
• **Utilities:** gemini_list_models, load_image_from_path, generate_landing_page
• **Help:** gemini_help (this tool)

## Quick Start
\`gemini_help topic="agents"\` - Launching autonomous Gemini agents
\`gemini_help topic="image_generation"\` - Image generation guide
\`gemini_help topic="grounding"\` - Search grounding features
\`gemini_help topic="media_resolution"\` - Token optimization
\`gemini_help topic="all"\` - Complete documentation

## Key Capabilities
✓ Google Search grounding for real-time data
✓ Multi-modal image generation with conversational editing
✓ Advanced image analysis with token optimization
✓ Deep research with iterative multi-step analysis
✓ Full-resolution image output (saved to disk)
✓ High-quality inline previews (1024px, quality 100)`,

  image_generation: `# Image Generation Guide

## Tool: generate_image

### Basic Usage
\`\`\`
generate_image(
  prompt="A photorealistic sunset over mountains",
  aspectRatio="16:9"
)
\`\`\`

### Parameters

**prompt** (required)
Description of the image to generate. Be specific and detailed.

**model** (optional, default: "gemini-3-pro-image-preview")
Options:
• gemini-3-pro-image-preview - Best quality, conversational editing support
• gemini-2.5-flash-image - Stable, fast generation
• nano-banana-pro-preview - Alias for gemini-3-pro-image-preview

**aspectRatio** (optional, default: "1:1")
Options: "1:1", "3:4", "4:3", "9:16", "16:9"
Use 16:9 for landscapes, 9:16 for portraits, 1:1 for squares

**imageSize** (optional)
Options: "1K", "2K", "4K"
Only works with image-specific models. Higher = more detail but slower.
Note: Preview is capped at 1024px, but full-res saved to disk

**use_search** (optional, default: false)
Enable Google Search grounding for real-time data.
Use for: weather forecasts, current events, stock prices, sports scores
Returns grounding sources as markdown links

**global_media_resolution** (optional, default: "HIGH")
For reference images only. See \`gemini_help topic="media_resolution"\`

**outputPath** (optional)
Custom save location. Otherwise saves to configured output directory.

### Output Resolution
• Generation: Full resolution (up to 4K depending on settings)
• Disk: Full resolution saved (always)
• Preview: 1024px max dimension, quality 100 (for inline display)

### Advanced: Conversational Editing
Generate an image, then edit it by passing the thoughtSignature:
\`\`\`
1. generate_image(prompt="A logo") → returns thoughtSignature
2. edit_image(
     prompt="Make it blue",
     images=[{data, mimeType, thoughtSignature}]
   )
\`\`\``,

  image_editing: `# Image Editing Guide

## Tool: edit_image

### Basic Usage
\`\`\`
edit_image(
  prompt="Change the color scheme to blue and green",
  images=[{data: base64Data, mimeType: "image/png"}]
)
\`\`\`

### Parameters

**prompt** (required)
Natural language instructions for how to edit the image(s).
Examples:
• "Make the background darker"
• "Add a red border"
• "Change to black and white"
• "Increase contrast and saturation"

**images** (required, array)
One or more images to edit. Each image object:
• data: Base64 encoded image data
• mimeType: Image MIME type (e.g., "image/png", "image/jpeg")
• thoughtSignature: (optional) For conversational editing
• mediaResolution: (optional) Per-image quality override

**model** (optional, default: "gemini-3-pro-image-preview")
Same options as generate_image

**use_search** (optional, default: false)
Enable Google Search for data-driven edits
Example: "Add current weather data for London"

**global_media_resolution** (optional, default: "HIGH")
Token cost optimization. See \`gemini_help topic="media_resolution"\`

**outputPath** (optional)
Custom save location for edited image

### Conversational Editing
For multi-step refinements with gemini-3-pro-image-preview:
1. First edit returns thoughtSignature
2. Pass thoughtSignature in subsequent edits
3. Model maintains visual context across iterations

### Tips
• Be specific: "Make brighter" vs "Increase brightness by 20%"
• Reference elements: "The sky in the background" vs "The background"
• Multiple images: Model can composite or compare them`,

  image_analysis: `# Image Analysis Guide

## Tools: describe_image, analyze_image

### describe_image - Text Descriptions

**Purpose:** Generate natural language descriptions of images

\`\`\`
describe_image(
  images=[{data: base64Data, mimeType: "image/jpeg"}],
  prompt="Describe this image in detail"
)
\`\`\`

Returns plain text description.

### analyze_image - Structured Analysis

**Purpose:** Extract specific information from images as structured data

\`\`\`
analyze_image(
  images=[{data: base64Data, mimeType: "image/png"}],
  prompt="Extract all text from this document and count words"
)
\`\`\`

Returns structured analysis based on prompt.

### Media Resolution (Cost Optimization)

**global_media_resolution** parameter:
• MEDIA_RESOLUTION_LOW (280 tokens, 75% savings)
  Use for: Simple tasks, bulk operations, thumbnails
• MEDIA_RESOLUTION_MEDIUM (560 tokens, 50% savings)
  Use for: PDFs, documents (OCR quality same as HIGH!)
• MEDIA_RESOLUTION_HIGH (1120 tokens, default)
  Use for: Detailed analysis, complex images

**Per-image override:**
\`\`\`
images=[
  {data: icon, mimeType: "image/png",
   mediaResolution: "MEDIA_RESOLUTION_LOW"},
  {data: detailed, mimeType: "image/png",
   mediaResolution: "MEDIA_RESOLUTION_ULTRA_HIGH"}
]
\`\`\`

ULTRA_HIGH (2000+ tokens) only available as per-image override.

### PDF Analysis Best Practice
For PDFs, use MEDIUM resolution:
• Same OCR quality as HIGH
• 50% token savings
• Perfect for multi-page documents`,

  chat: `# Chat & Conversation Guide

## Tool: gemini_chat

### Basic Usage
\`\`\`
gemini_chat(
  message="Explain quantum entanglement",
  model="gemini-3-pro-preview"
)
\`\`\`

### Parameters

**message** (required)
Your message/question to Gemini

**model** (optional)
Options: See \`gemini_help topic="models"\`

**grounding** (optional, default: false)
Enable Google Search grounding for current information
Returns grounding metadata with sources

**max_tokens** (optional, default: 65536)
Maximum tokens in response (1-65536)

**temperature** (optional, default: 0.7)
Randomness (0.0-1.0). Lower = more focused, Higher = more creative

**thinking_level** (optional)
For Gemini 3 models only:
• "LOW" - Minimal reasoning, fast responses
• "MEDIUM" - Balanced (Flash only)
• "HIGH" - Deep reasoning, slower (default for Gemini 3)
• "MINIMAL" - Absolute minimum thinking (Flash only)

**system_prompt** (optional)
System-level instructions for the model

### Grounding Example
\`\`\`
gemini_chat(
  message="What are the latest developments in the MCP specification?",
  grounding=true
)
\`\`\`
Returns current information with source citations.`,

  deep_research: `# Deep Research Guide

## Tool: gemini_deep_research

### Purpose
Conduct comprehensive multi-step research on complex topics with live web search.

### Usage
\`\`\`
gemini_deep_research(
  research_question="What are the implications of quantum computing for cryptography?",
  focus_areas=["RSA encryption", "Post-quantum algorithms"]
)
\`\`\`

### How it works
Runs Google's real Deep Research agent through the Gemini Interactions API.
The agent autonomously performs many rounds of live web search and returns a
synthesised, cited report — the actual Deep Research product, not a
grounding-augmented chat. Runs asynchronously (created as a background
interaction, then polled) and takes several minutes.

### Parameters

**research_question** (required)
Complex research question or topic to investigate deeply

**model** (optional, default "deep-research-pro-preview-12-2025")
Deep Research agent to use:
• deep-research-pro-preview-12-2025 — default
• deep-research-preview-04-2026
• deep-research-max-preview-04-2026 — most thorough (and slowest)

**focus_areas** (optional, array)
Specific areas to focus the research on
Example: ["clinical trials", "side effects", "dosage"]

### Returns
Comprehensive research report with:
• Executive summary
• Key findings organized by theme
• Source citations
• Confidence assessments
• Recommended follow-up questions

### Best For
• Complex topics requiring multiple sources
• Academic or technical research
• Comparative analysis across domains
• Questions with no single definitive answer`,

  documents: `# Documents Guide (OCR & Summary)

## Tool: ocr
Extract text **verbatim** from images or PDFs (no summarising/analysis).
\`\`\`
ocr(
  images=[{filePath="/abs/scan.pdf"}],
  language="German"
)
\`\`\`
• images — array; use filePath for large files (incl. .pdf).
• language — optional language hint, improves accuracy.
• global_media_resolution — default MEDIA_RESOLUTION_MEDIUM (same OCR quality
  as HIGH at 50% token cost; ideal for documents).
Returns the raw text as Markdown (headings/lists/tables preserved).

## Tool: generate_summary
Summarise text or **almost any local file**.
\`\`\`
generate_summary(
  file_path="/abs/report.pdf",
  length="bullets",
  focus="risks and open questions"
)
\`\`\`
• text OR file_path — file_path accepts text/code, PDF, images, audio, video
  (loaded server-side; Office docs must be exported to PDF first). Text/code is
  summarised directly; PDF/media go through the multimodal model.
• length — brief | standard (default) | detailed | bullets.
• focus — optional angle to emphasise.
• language — optional output language (defaults to source language).
Tip: to summarise a scanned document, you can ocr() it first, then summarise
the text — or just pass the file to generate_summary directly.

## Tool: transcribe
Transcribe speech from an audio or video file.
\`\`\`
transcribe(
  file_path="/abs/meeting.m4a",
  language="German",
  timestamps=true,
  diarization=true
)
\`\`\`
• file_path (audio/video) OR data + mime_type for inline base64.
• language — optional spoken-language hint.
• timestamps — prefix lines with [mm:ss].
• diarization — label speakers (Speaker 1, Speaker 2, ...).
Returns the transcript text only.

## Tool: extract_structured_data
Pull structured JSON out of text or any file (JSON mode).
\`\`\`
extract_structured_data(
  file_path="/abs/invoice.pdf",
  instructions="invoice number, date, total, and an array of line items"
)
\`\`\`
• instructions — describe the fields/data you want (required).
• text OR file_path — file_path accepts text/code, PDF, image, audio, video.
• json_schema — optional Gemini/OpenAPI-subset schema to enforce the shape.
Returns parsed, pretty-printed JSON (falls back to raw text with a warning if
the model returns invalid JSON).`,

  agents: `# Gemini Agents Guide

## Tools: gemini_agent, gemini_agent_models

Launch an **autonomous Gemini agent** through the \`agy\` CLI. Where gemini_chat
returns one text answer, an agent can read & edit files and run shell commands
in a working directory to actually *do* multi-step work, then reports back.
Think of it as delegating a self-contained task to a Gemini coworker.

### Basic Usage
\`\`\`
gemini_agent(
  task="In /home/me/proj, add a --json flag to the CLI and update the README.",
  directory="/home/me/proj",
  model="Gemini 3.1 Pro (High)"
)
\`\`\`

### Parameters
**task** (required)
Self-contained instructions: goal, relevant paths, constraints, definition of
done. The agent runs unattended — there is no chance to clarify mid-run.

**model** (optional)
Exact label from \`gemini_agent_models\`, e.g. "Gemini 3.5 Flash (Low)" (fast,
cheap) or "Gemini 3.1 Pro (High)" (deeper reasoning, slower). Note: these are
agent labels and differ from the API models in gemini_list_models.

**directory** (optional)
Primary working directory (the agent's cwd). Defaults to the server's cwd.

**add_directories** (optional, array)
Extra paths to grant the agent access to.

**conversation_id** (optional)
Returned by a previous run. Pass it back to continue iterating with the same
agent, keeping its context.

**continue_recent** (optional, default false)
Continue the most recent agent conversation (ignored if conversation_id set).

**auto_approve** (optional, default true)
Auto-approve the agent's tool/permission requests so it can work unattended.
Disabling it will make the agent stall, since print mode has no interactive
approver. Override the default with env GEMINI_AGY_AUTO_APPROVE=false.

**sandbox** (optional, default false)
Run inside agy's restricted sandbox (limited terminal).

**timeout_seconds** (optional)
Hard budget. Pro/High runs can take minutes; raise this for big tasks.

### Returns
The agent's final report, plus a footer with the **conversation_id** (for
follow-ups), the model used, and the wall-clock duration. If the run hits the
timeout you get a partial result and a warning — continue via conversation_id.

### Tips
• Start with a Flash model for quick/cheap tasks; switch to Pro for hard ones.
• Keep tasks self-contained and scoped to a directory.
• Iterate: launch → review the report → continue with conversation_id.
• Auth is agy's own (Antigravity / Cloud Code login), independent of GEMINI_API_KEY.`,

  grounding: `# Google Search Grounding Guide

## What is Grounding?
Grounding connects Gemini to Google Search for real-time, factual information.

## Available in Tools
• gemini_chat (grounding parameter)
• generate_image (use_search parameter)
• edit_image (use_search parameter)

## Chat Grounding
\`\`\`
gemini_chat(
  message="What happened in tech news today?",
  grounding=true
)
\`\`\`

**Returns:**
• Current information (not training data)
• Grounding metadata with sources
• Web search queries used

**Best for:**
• Current events and news
• Recent developments in any field
• Fact-checking and verification
• Topics that change frequently

## Image Grounding
\`\`\`
generate_image(
  prompt="Weather forecast for London tomorrow with actual temperatures",
  use_search=true
)
\`\`\`

**Returns:**
• Image with real-time data
• Grounding sources as markdown links
• Search queries used

**Best for:**
• Weather forecasts
• Stock prices and financial data
• Sports scores and statistics
• Current events infographics
• Any data-driven visualizations

## Important Notes
• Grounding adds latency (search takes time)
• Sources returned as clickable markdown links
• Not needed for general knowledge or creative tasks
• Most valuable for factual, current information`,

  media_resolution: `# Media Resolution & Token Optimization

## What is Media Resolution?
Controls image quality when analyzing images, trading quality for token cost.

## Resolution Levels

**MEDIA_RESOLUTION_LOW (280 tokens)**
• 75% token savings vs HIGH
• Use for: Simple visual tasks, thumbnails, bulk processing
• Quality: Sufficient for basic recognition and simple questions

**MEDIA_RESOLUTION_MEDIUM (560 tokens)**
• 50% token savings vs HIGH
• Use for: PDFs, documents, screenshots
• Quality: **Same OCR quality as HIGH!** (OCR saturates at medium)
• **RECOMMENDED for all document analysis**

**MEDIA_RESOLUTION_HIGH (1120 tokens)**
• Default quality level
• Use for: Complex images, detailed analysis
• Quality: Full fidelity for most tasks

**MEDIA_RESOLUTION_ULTRA_HIGH (2000+ tokens)**
• Maximum detail, per-image only (not global)
• Use for: Pixel-perfect analysis, fine details, medical imaging
• Quality: Highest possible fidelity

## Usage

### Global Setting (All Images)
\`\`\`
analyze_image(
  images=[{data1}, {data2}, {data3}],
  prompt="Analyze these images",
  global_media_resolution="MEDIA_RESOLUTION_MEDIUM"
)
\`\`\`

### Per-Image Override (Mixed Quality)
\`\`\`
analyze_image(
  images=[
    {data: simple, mimeType: "image/png",
     mediaResolution: "MEDIA_RESOLUTION_LOW"},
    {data: detailed, mimeType: "image/png",
     mediaResolution: "MEDIA_RESOLUTION_ULTRA_HIGH"}
  ],
  global_media_resolution="MEDIA_RESOLUTION_MEDIUM"
)
\`\`\`

Per-image setting overrides global setting.

## Best Practices

**For PDFs/Documents:**
Always use MEDIUM - same OCR quality, 50% cost savings

**For Bulk Processing:**
Use LOW for simple tasks (thumbnails, basic recognition)

**For Mixed Batches:**
Set global to MEDIUM, override specific images to ULTRA_HIGH

**For Cost Optimization:**
Start with MEDIUM, only increase if quality insufficient`,

  models: `# Gemini Models Reference

## Chat Models

**Gemini 3 Series (Latest)**
• gemini-3-pro-preview - Best reasoning, supports thinking levels
• gemini-3-flash-preview - Fast, supports thinking levels
• gemini-3.1-pro-preview - Enhanced reasoning
• gemini-3.1-pro-preview-customtools - Optimized for tool use

**Gemini 2.5 Series (Stable)**
• gemini-2.5-pro - Stable flagship model
• gemini-2.5-flash - Stable fast model
• gemini-2.5-flash-lite - Lightweight, efficient

**Gemini 2.0 Series**
• gemini-2.0-flash - Versatile multimodal
• gemini-2.0-flash-001 - Stable version
• gemini-2.0-flash-lite - Lightweight variant

**Aliases**
• gemini-flash-latest - Latest Flash release
• gemini-pro-latest - Latest Pro release

## Image Generation Models

**gemini-3-pro-image-preview** (Nano Banana Pro)
• Best quality image generation
• Supports conversational editing via thoughtSignatures
• Default for generate_image and edit_image

**gemini-2.5-flash-image**
• Stable image generation
• Fast, reliable
• No conversational editing

**nano-banana-pro-preview**
• Alias for gemini-3-pro-image-preview

## Image Analysis Models

All chat models support image analysis via:
• describe_image
• analyze_image

Recommended:
• gemini-3-flash-preview (default) - Fast, accurate
• gemini-3-pro-preview - Best quality analysis

## Specialized Models

**gemini-2.5-computer-use-preview-10-2025**
• Computer interaction tasks

**deep-research-pro-preview-12-2025**
• Deep research iterations

**Gemma Models**
• gemma-3-1b-it through gemma-3-27b-it
• Open weights models for research

## Model Selection Tips

**For Chat:**
• Quick questions: gemini-3-flash-preview
• Complex reasoning: gemini-3-pro-preview
• Stable production: gemini-2.5-pro

**For Images:**
• Generation: gemini-3-pro-image-preview (only one with editing)
• Analysis: gemini-3-flash-preview (fast, accurate)

**For Research:**
• deep-research-pro-preview-12-2025

Use \`gemini_list_models\` to see all available models with descriptions.`,
};

export function registerGeminiHelp(server: McpServer): void {
  server.registerTool(
    'gemini_help',
    {
      title: 'Gemini MCP Help',
      description: 'Get comprehensive help about Gemini MCP features, settings, and best practices',
      inputSchema: {
        topic: z.enum([
          'overview',
          'image_generation',
          'image_editing',
          'image_analysis',
          'chat',
          'deep_research',
          'agents',
          'documents',
          'grounding',
          'media_resolution',
          'models',
          'all',
        ])
          .optional()
          .default('overview')
          .describe('Help topic to display'),
      },
    },
    async ({ topic }) => {
      if (topic === 'all') {
        const allTopics = Object.keys(HELP_TOPICS)
          .map((t) => HELP_TOPICS[t])
          .join('\n\n---\n\n');
        return { content: [{ type: 'text' as const, text: allTopics }] };
      }

      const content = HELP_TOPICS[topic];
      if (!content) {
        return {
          content: [{
            type: 'text' as const,
            text: `Unknown help topic: ${topic}\n\nAvailable topics:\n${Object.keys(HELP_TOPICS).join('\n')}`,
          }],
        };
      }

      return { content: [{ type: 'text' as const, text: content }] };
    }
  );
}
