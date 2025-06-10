require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");

const PDF_PATH = process.env.PDF_PATH || "./gurps_basic.pdf";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./output";
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "100", 10);
const GPT_MODEL = process.env.GPT_MODEL || "gpt-4-turbo";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SECTIONS_PATH = path.join(__dirname, "../sections.json");
const RETRY_LIMIT = 3;

const PROMPT_TEMPLATE =
  "Extract structured GURPS data from this text in valid JSON format. Ensure correct grouping of traits, attributes, or items under their proper categories. Preserve nesting for categories and subcategories if relevant. Avoid redundancy and ensure valid JSON.";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function loadSections() {
  return JSON.parse(await fs.readFile(SECTIONS_PATH, "utf-8"));
}

async function extractTextByPages(pdfPath, startPage, endPage) {
  const dataBuffer = await fs.readFile(pdfPath);
  const pdfData = await pdfParse(dataBuffer);
  // Debug: print some info about the extracted text
  console.log("--- PDF Extract Debug ---");
  console.log("Total extracted text length:", pdfData.text.length);
  const preview = pdfData.text.split("\n").slice(0, 20).join("\n");
  console.log("First 20 lines of text:", preview);
  // Try splitting by form feed, but fallback to splitting by lines if needed
  let allPages = pdfData.text.split(/\f/);
  if (allPages.length < endPage || allPages.length === 1) {
    console.warn(
      "Form feed split did not yield enough pages. Falling back to line-based chunking."
    );
    // Estimate lines per page and slice lines instead
    const lines = pdfData.text.split("\n");
    const linesPerPage = Math.floor(
      lines.length / (pdfData.numpages || endPage)
    );
    const startLine = (startPage - 1) * linesPerPage;
    const endLine = endPage * linesPerPage;
    return lines.slice(startLine, endLine);
  }
  return allPages
    .slice(startPage - 1, endPage)
    .join("\n")
    .split("\n");
}

function chunkLines(lines, chunkSize) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize));
  }
  return chunks;
}

async function gptExtract(chunk, model, prompt) {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: chunk },
    ],
    temperature: 0.2,
    max_tokens: 2048,
  });
  // Remove markdown code block if present
  let content = completion.choices[0].message.content.trim();
  if (content.startsWith("```json")) {
    content = content.replace(/^```json\s*/, "").replace(/```\s*$/, "");
  } else if (content.startsWith("```")) {
    content = content.replace(/^```\w*\s*/, "").replace(/```\s*$/, "");
  }
  return content;
}

const SCHEMA_DIR = path.join(OUTPUT_DIR, "schemas");

async function getOrCreateSchema(section, chunks) {
  await fs.ensureDir(SCHEMA_DIR);
  const schemaPath = path.join(SCHEMA_DIR, `${section}.schema.json`);
  if (await fs.pathExists(schemaPath)) {
    return await fs.readFile(schemaPath, "utf-8");
  }
  // Find the first non-empty, sufficiently long chunk
  let chunkText = "";
  for (const chunk of chunks) {
    const text = chunk.join("\n").trim();
    if (text.length > 100) {
      // Arbitrary threshold for 'enough' data
      chunkText = text;
      break;
    }
  }
  if (!chunkText)
    throw new Error("No sufficiently large chunk found for schema extraction.");
  const schemaPrompt = `Analyze the following GURPS section and return ONLY the JSON schema (structure, not data) that should be used to represent this section. Do not include any data, only the structure. Example: {\n  \"name\": \"string\", ... }`;
  let schemaResponse = "";
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      schemaResponse = await gptExtract(chunkText, GPT_MODEL, schemaPrompt);
      // Try to parse to validate JSON, but save as string
      JSON.parse(schemaResponse);
      await fs.writeFile(schemaPath, schemaResponse, "utf-8");
      return schemaResponse;
    } catch (e) {
      if (attempt === RETRY_LIMIT) throw e;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

async function processSection(section, pageRange) {
  console.log(
    `Processing section: ${section} (pages ${pageRange[0]}-${pageRange[1]})`
  );
  const lines = await extractTextByPages(PDF_PATH, pageRange[0], pageRange[1]);
  const chunks = chunkLines(lines, CHUNK_SIZE);
  const sectionData = [];
  await fs.ensureDir(OUTPUT_DIR);
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const chunkText = chunk.join("\n");
    const rawChunkPath = path.join(
      OUTPUT_DIR,
      `${section}_chunk_${idx + 1}.txt`
    );
    await fs.writeFile(rawChunkPath, chunkText, "utf-8");
    let gptResponse = "";
    for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
      try {
        gptResponse = await gptExtract(chunkText, GPT_MODEL, PROMPT_TEMPLATE);
        const data = JSON.parse(gptResponse);
        if (Array.isArray(data)) sectionData.push(...data);
        else sectionData.push(data);
        break;
      } catch (e) {
        console.error(
          `Error in chunk ${idx + 1}, attempt ${attempt}:`,
          e.message
        );
        const errorPath = path.join(
          OUTPUT_DIR,
          `${section}_chunk_${idx + 1}.error.txt`
        );
        await fs.writeFile(errorPath, e.message + "\n" + gptResponse, "utf-8");
        if (attempt === RETRY_LIMIT) {
          console.error(
            `Failed to process chunk ${idx + 1} after ${RETRY_LIMIT} attempts.`
          );
        } else {
          await new Promise((res) => setTimeout(res, 2000));
        }
      }
    }
  }
  const outputPath = path.join(OUTPUT_DIR, `${section}.json`);
  await fs.writeFile(outputPath, JSON.stringify(sectionData, null, 2), "utf-8");
  console.log(`Section '${section}' written to ${outputPath}`);
}

async function processSectionTest(section, pageRange) {
  console.log(
    `Test mode: Processing only the first chunk of section: ${section}`
  );
  const lines = await extractTextByPages(PDF_PATH, pageRange[0], pageRange[1]);
  const chunks = chunkLines(lines, CHUNK_SIZE);
  if (chunks.length === 0) {
    console.log("No data found for this section.");
    return;
  }
  await fs.ensureDir(OUTPUT_DIR);
  // Get or create schema using all chunks (to find a good one)
  const schema = await getOrCreateSchema(section, chunks);
  // Use the first non-empty chunk for the test
  let chunk = chunks[0];
  let chunkText = chunk.join("\n");
  for (const c of chunks) {
    const text = c.join("\n").trim();
    if (text.length > 100) {
      chunk = c;
      chunkText = text;
      break;
    }
  }
  const rawChunkPath = path.join(OUTPUT_DIR, `${section}_chunk_test.txt`);
  await fs.writeFile(rawChunkPath, chunkText, "utf-8");
  const promptWithSchema = `${PROMPT_TEMPLATE}\n\nUse this JSON structure as a guide:\n${schema}`;
  let gptResponse = "";
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      gptResponse = await gptExtract(chunkText, GPT_MODEL, promptWithSchema);
      const data = JSON.parse(gptResponse);
      const outputPath = path.join(OUTPUT_DIR, `${section}_test.json`);
      await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf-8");
      console.log(`Test output written to ${outputPath}`);
      return;
    } catch (e) {
      const errorPath = path.join(
        OUTPUT_DIR,
        `${section}_chunk_test.error.txt`
      );
      await fs.writeFile(errorPath, e.message + "\n" + gptResponse, "utf-8");
      if (attempt === RETRY_LIMIT) {
        console.error(
          `Failed to process test chunk after ${RETRY_LIMIT} attempts.`
        );
      } else {
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
  }
}

async function saveSectionText(section, pageRange) {
  console.log(`Extracting and saving raw text for section: ${section}`);
  const lines = await extractTextByPages(PDF_PATH, pageRange[0], pageRange[1]);
  const text = lines.join("\n");
  const textPath = path.join(OUTPUT_DIR, `${section}_text.txt`);
  await fs.writeFile(textPath, text, "utf-8");
  console.log(`Raw text for section '${section}' saved to ${textPath}`);
}

async function main() {
  const sections = await loadSections();
  const args = process.argv.slice(2);
  if (args[0] === "--extract-text" && args[1]) {
    const section = args[1];
    if (!sections[section]) {
      console.error(`Section '${section}' not found in sections.json.`);
      process.exit(1);
    }
    await saveSectionText(section, sections[section]);
    return;
  }
  if (args[0] === "--test" && args[1]) {
    const section = args[1];
    if (!sections[section]) {
      console.error(`Section '${section}' not found in sections.json.`);
      process.exit(1);
    }
    await processSectionTest(section, sections[section]);
    return;
  }
  for (const [section, pageRange] of Object.entries(sections)) {
    await processSection(section, pageRange);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
