// Import required libraries
const pdfjsLib = require('pdfjs-dist');
const { createClient } = require('@pinecone-database/client');
const { OpenAIApi, Configuration } = require('openai');
const { encode } = require('gpt-3-encoder'); // For chunking based on token limits

// Setup OpenAI API and Pinecone Client
const openaiConfig = new Configuration({ apiKey: 'YOUR_OPENAI_API_KEY' });
const openai = new OpenAIApi(openaiConfig);

const pinecone = createClient({
  apiKey: 'YOUR_PINECONE_API_KEY',
  environment: 'us-east1-gcp'
});
const pineconeIndex = pinecone.index('your-index-name');

// Helper Function: Extract text from PDF
async function extractTextFromPDF(pdfPath) {
  const pdf = await pdfjsLib.getDocument(pdfPath).promise;
  let extractedText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    textContent.items.forEach((item) => {
      extractedText += item.str + ' ';
    });
  }
  return extractedText;
}

// Helper Function: Chunk text based on token limit
function chunkText(text, tokenLimit = 512) {
  const tokens = encode(text);
  let chunks = [];
  for (let i = 0; i < tokens.length; i += tokenLimit) {
    const chunk = tokens.slice(i, i + tokenLimit);
    chunks.push(chunk);
  }
  return chunks.map((chunk) => chunk.join(' '));
}

// Helper Function: Generate embeddings
async function generateEmbeddings(chunks) {
  const embeddings = await Promise.all(
    chunks.map(async (chunk) => {
      const response = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: chunk
      });
      return response.data.data[0].embedding;
    })
  );
  return embeddings;
}

// Helper Function: Store embeddings in Pinecone
async function storeEmbeddingsInPinecone(embeddings, chunks) {
  const upserts = embeddings.map((embedding, index) => ({
    id: chunk-${index},
    values: embedding,
    metadata: { text: chunks[index] }
  }));
  await pineconeIndex.upsert({ upserts });
}

// Main Function: PDF Ingestion
async function ingestPDF(pdfPath) {
  const text = await extractTextFromPDF(pdfPath);
  const chunks = chunkText(text);
  const embeddings = await generateEmbeddings(chunks);
  await storeEmbeddingsInPinecone(embeddings, chunks);
  console.log('PDF data ingested and stored in vector database.');
}

// Query Handling
async function handleQuery(query) {
  // Generate query embedding
  const queryEmbeddingResponse = await openai.createEmbedding({
    model: 'text-embedding-ada-002',
    input: query
  });
  const queryEmbedding = queryEmbeddingResponse.data.data[0].embedding;

  // Search in Pinecone
  const searchResults = await pineconeIndex.query({
    vector: queryEmbedding,
    topK: 5,
    includeMetadata: true
  });

  // Prepare retrieved chunks for response generation
  const retrievedChunks = searchResults.matches.map((match) => match.metadata.text).join('\n');

  // Generate response with LLM
  const llmResponse = await openai.createCompletion({
    model: 'gpt-4',
    prompt: Use the following context to answer the query:\n\n${retrievedChunks}\n\nQuery: ${query}\nAnswer:,
    max_tokens: 200
  });

  return llmResponse.data.choices[0].text.trim();
}

// Example Usage
(async () => {
  // Ingest PDF file
  const pdfPath = 'path/to/your/pdf-file.pdf';
  await ingestPDF(pdfPath);

  // Handle user query
  const userQuery = 'What is the unemployment rate for people with a bachelor’s degree?';
  const response = await handleQuery(userQuery);
  console.log('Response:', response);
})();