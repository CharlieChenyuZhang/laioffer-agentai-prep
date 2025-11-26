import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Search the web using SerpAPI
 * @param {string} query - The search query
 * @returns {Promise<object>} - Search results
 */
const searchWeb = async (query) => {
  try {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      throw new Error("SERPAPI_KEY not found in environment variables");
    }

    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(
      query
    )}&api_key=${apiKey}`;
    const response = await fetch(url);
    const results = await response.json();

    // Format the results
    let formattedResults = `Web Search Results for: ${query}\n\n`;

    if (results.organic_results && results.organic_results.length > 0) {
      formattedResults += "Top Results:\n";
      results.organic_results.slice(0, 5).forEach((result, index) => {
        formattedResults += `${index + 1}. ${result.title}\n`;
        formattedResults += `   📎 Source: ${result.link}\n`;
        if (result.snippet) {
          formattedResults += `   ${result.snippet}\n`;
        }
        formattedResults += "\n";
      });
    }

    if (results.answer_box && results.answer_box.answer) {
      formattedResults += `Direct Answer: ${results.answer_box.answer}\n`;
      if (results.answer_box.link) {
        formattedResults += `📎 Source: ${results.answer_box.link}\n`;
      }
      formattedResults += "\n";
    }

    return {
      content: [
        {
          type: "text",
          text: formattedResults,
        },
      ],
    };
  } catch (error) {
    console.error("Error in web search:", error);
    return {
      content: [
        {
          type: "text",
          text: `Web search encountered an error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
};

// Create MCP Server
const server = new Server(
  {
    name: "serpapi-search-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_web",
        description:
          "Search the web using Google via SerpAPI. Use this tool when you need current information, recent events, or information not available in the uploaded document. The query should be a clear search string.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to execute",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_web") {
    if (!args || typeof args.query !== "string") {
      return {
        content: [
          {
            type: "text",
            text: "Error: 'query' parameter is required and must be a string",
          },
        ],
        isError: true,
      };
    }

    return await searchWeb(args.query);
  }

  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SerpAPI MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
