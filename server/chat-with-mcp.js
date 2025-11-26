import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { Tool } from "@langchain/core/tools";
import chat from "./chat.js";
import { callMcpTool } from "./mcpClient.js";

/**
 * Enhanced chat function that combines RAG (from chat.js) with MCP web search
 * The LLM decides when to use web search vs document search
 */
const chatWithMCP = async (filePath, query) => {
  // Step 1: Get RAG response from original chat function
  const ragResponse = await chat(filePath, query);
  const ragAnswer = ragResponse.text || ragResponse;

  // Step 2: Create an agent that can decide if web search is needed
  const apiKey =
    process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
  const model = new ChatOpenAI({
    model: "gpt-5",
    ...(apiKey && { apiKey }),
  });

  // Create a tool that returns the RAG answer
  class RAGAnswerTool extends Tool {
    name = "document_answer";
    description = `Get the answer from the uploaded document. This contains the RAG (Retrieval Augmented Generation) response based on the document content. Use this as the primary source of information.`;

    async _call(input) {
      return ragAnswer;
    }
  }

  const ragTool = new RAGAnswerTool();

  // Tool that calls the MCP server's `search_web` tool over stdio
  class McpWebSearchTool extends Tool {
    name = "search_web";

    description = `Search the web using Google via SerpAPI through an MCP server. Use this tool when you need current information, recent events, or information that might not be available in the uploaded document. The input should be a clear, specific search query string.`;

    async _call(input) {
      return await callMcpTool("search_web", { query: input });
    }
  }

  const webSearchTool = new McpWebSearchTool();

  // System message guiding the LLM
  const systemMessage = `You are a helpful assistant with access to two information sources:
1. document_answer - The answer from the uploaded PDF document (RAG response)
2. search_web - Search the web for current information using Google

First, use document_answer to get the answer from the document. Only use search_web if:
- The question requires current/up-to-date information not in the document
- The document answer indicates information is missing or outdated
- The question is about recent events, current data, or real-time information

Combine information from both sources if needed. Provide a concise answer (maximum 3 sentences).

Document Answer: ${ragAnswer}`;

  // Create agent with both tools - LLM decides when to use web search
  const agent = await createAgent({
    model: model,
    tools: [ragTool, webSearchTool],
    prompt: systemMessage,
  });

  const response = await agent.invoke({
    messages: [{ role: "user", content: `User Question: ${query}` }],
  });

  // Extract the final answer from the response
  const finalAnswer =
    response.messages && response.messages.length > 0
      ? response.messages[response.messages.length - 1].content
      : response.output || response.answer || response.text || String(response);

  return {
    text: finalAnswer,
    ragAnswer: ragAnswer,
    mcpAnswer: finalAnswer,
  };
};

export default chatWithMCP;
