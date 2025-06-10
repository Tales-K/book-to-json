````md
# 📘 GURPS PDF to Structured JSON: Processing Rules

This project extracts structured game data from a large GURPS rulebook PDF using GPT and outputs multiple JSON files—one for each logical section (e.g., Advantages, Disadvantages, Skills).

---

## ✅ Project Goal

Convert a single large GURPS book (PDF format) into **clean, structured JSON files**, separated by content category. Each category (e.g., advantages, disadvantages) is extracted from a specific page range, as defined in a config.

---

## 📄 Input File

- One single PDF file (e.g., `gurps_basic.pdf`), >80MB.
- File contains various sections: Advantages, Disadvantages, Skills, etc.

---

## 🧭 Section Mapping

The PDF will be processed in **manual segments** by specifying multiple page ranges, like:

```json
{
  "advantages": [30, 110],
  "disadvantages": [111, 160],
  "skills": [161, 200],
  "equipment": [201, 250]
}
````

Each key will define:

* The **name** of the output file (`advantages.json`)
* The **page range** (`startPage` to `endPage`) to be parsed

---

## 🔍 GPT Prompt Template

Each chunk from the selected section will be passed to GPT with a prompt like:

> "Extract structured GURPS data from this text in valid JSON format. Ensure correct grouping of traits, attributes, or items under their proper categories. Preserve nesting for categories and subcategories if relevant. Avoid redundancy and ensure valid JSON."

Optional: a few schema examples per category may be added to improve results.

---

## 🧱 Chunking Rules

* Each section will be processed page-by-page or in chunks (default: 100 lines per chunk).
* Chunking is done **within the boundaries of a single section only**.
* Text from pages **outside the defined range** is ignored.

---

## 📂 Output Rules

For each section:

* Output file is named `<section>.json`, e.g.,:

  * `advantages.json`
  * `disadvantages.json`
  * `skills.json`
* Stored in an `output/` directory.

Intermediate or debug outputs:

* Raw text chunk (optional): `output/advantages_chunk_1.txt`
* GPT failure logs (if needed): `output/advantages_chunk_2.error.txt`

---

## 📑 Example Schema per Section

### Advantages / Disadvantages

```json
[
  {
    "name": "Combat Reflexes",
    "type": "Advantage",
    "cost": 15,
    "description": "You gain +1 to active defense rolls...",
    "notes": "Cannot be combined with Surprise bonuses."
  }
]
```

### Skills

```json
[
  {
    "name": "Stealth",
    "difficulty": "Average",
    "default": ["DX-5", "Shadowing-4"],
    "description": "Use this to avoid being seen or heard.",
    "specializations": []
  }
]
```

---

## ⚙️ Configuration

Define in a file like `sections.json`:

```json
{
  "advantages": [30, 110],
  "disadvantages": [111, 160],
  "skills": [161, 200],
  "equipment": [201, 250]
}
```

Also, include a `.env` file:

```env
OPENAI_API_KEY=your-api-key-here
CHUNK_SIZE=100
PDF_PATH=./gurps_basic.pdf
OUTPUT_DIR=./output
GPT_MODEL=gpt-4-turbo
```

---

## 🔁 Error Handling

* Each chunk is retried up to 3 times on failure.
* Invalid JSON responses are logged.
* You can manually reprocess error chunks.

---

## 🚫 Exclusions

* No image-based OCR: PDF must be text-based.
* No cross-section merging: each section is self-contained.

```

## Techs

* Use node and javascript for the entire processing
````