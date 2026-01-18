"""
Flask Web Application for Azure Log Analytics KQL Queries

This app provides a web interface to execute KQL queries against
Azure Log Analytics workspaces using Azure credentials.
"""

import os
import json
from datetime import timedelta
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from openai import AzureOpenAI
from monitor_client import AzureMonitorAgent

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Default workspace ID (can be overridden in the UI)
DEFAULT_WORKSPACE_ID = os.getenv("AZURE_LOG_ANALYTICS_WORKSPACE_ID", "")

# Azure OpenAI configuration
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY")
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4")

# Initialize Azure OpenAI client
openai_client = None
if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY:
    openai_client = AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_key=AZURE_OPENAI_KEY,
        api_version="2024-02-15-preview"
    )


@app.route("/")
def index():
    """Render the main query interface."""
    return render_template("index.html", default_workspace_id=DEFAULT_WORKSPACE_ID)


@app.route("/api/query", methods=["POST"])
def execute_query():
    """Execute a KQL query and return results as JSON."""
    try:
        data = request.get_json()
        workspace_id = data.get("workspace_id", "").strip()
        kql_query = data.get("query", "").strip()
        timespan_hours = data.get("timespan_hours", 1)

        if not workspace_id:
            return jsonify({"error": "Workspace ID is required"}), 400

        if not kql_query:
            return jsonify({"error": "Query is required"}), 400

        # Create Azure Monitor agent with default credentials
        agent = AzureMonitorAgent()

        # Set up timespan
        timespan = timedelta(hours=int(timespan_hours))

        # Execute the query
        result = agent.query_log_analytics(
            workspace_id=workspace_id,
            kql_query=kql_query,
            timespan=timespan
        )

        if "error" in result:
            return jsonify({"error": result["error"]}), 400

        # Process tables for JSON response
        tables = result.get("tables", [])
        processed_tables = []
        total_rows = 0

        for table in tables:
            # Convert rows to list of dicts for easier frontend consumption
            columns = table.get("columns", [])
            rows = table.get("rows", [])
            
            # Convert rows to list format if needed
            processed_rows = []
            for row in rows:
                if hasattr(row, '__iter__') and not isinstance(row, (str, dict)):
                    processed_rows.append(list(row))
                else:
                    processed_rows.append(row)

            processed_tables.append({
                "name": table.get("name", "Result"),
                "columns": columns,
                "rows": processed_rows,
                "row_count": len(processed_rows)
            })
            total_rows += len(processed_rows)

        return jsonify({
            "success": True,
            "tables": processed_tables,
            "total_rows": total_rows
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/test-connection", methods=["POST"])
def test_connection():
    """Test connection to a workspace."""
    try:
        data = request.get_json()
        workspace_id = data.get("workspace_id", "").strip()

        if not workspace_id:
            return jsonify({"error": "Workspace ID is required"}), 400

        agent = AzureMonitorAgent()
        
        # Simple test query
        result = agent.query_log_analytics(
            workspace_id=workspace_id,
            kql_query="print 'Connection successful'",
            timespan=timedelta(hours=1)
        )

        if "error" in result:
            return jsonify({
                "success": False,
                "message": f"Connection failed: {result['error']}"
            })

        return jsonify({
            "success": True,
            "message": "Successfully connected to workspace"
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Connection failed: {str(e)}"
        })


@app.route("/api/explain", methods=["POST"])
def explain_results():
    """Generate an AI explanation of query results."""
    try:
        if not openai_client:
            return jsonify({"error": "Azure OpenAI not configured"}), 500

        data = request.get_json()
        query = data.get("query", "")
        tables = data.get("tables", [])
        total_rows = data.get("total_rows", 0)

        # Prepare a summary of results for the AI
        results_summary = []
        for table in tables:
            table_info = {
                "name": table.get("name", "Unknown"),
                "columns": table.get("columns", []),
                "row_count": table.get("row_count", 0),
                "sample_rows": table.get("rows", [])[:5]  # First 5 rows as sample
            }
            results_summary.append(table_info)

        prompt = f"""You are an Azure Log Analytics expert. Analyze the following KQL query and its results, then provide a clear, helpful explanation.

## KQL Query:
```kql
{query}
```

## Results Summary:
- Total rows returned: {total_rows}
- Tables: {json.dumps(results_summary, indent=2, default=str)}

## Instructions:
1. **Query Explanation**: Briefly explain what this KQL query does in plain language.
2. **Results Analysis**: Describe what the results show - patterns, notable values, or insights.
3. **Table/Column Context**: If you recognize standard Azure tables (like Heartbeat, AzureActivity, requests, exceptions, traces, etc.), explain what these tables typically contain and what the columns mean.
4. **Insights**: Highlight any interesting findings, potential issues, or recommendations based on the data.

Keep the explanation concise but informative. Use bullet points for clarity. If the results are empty, explain possible reasons why."""

        response = openai_client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT,
            messages=[
                {"role": "system", "content": "You are an expert in Azure Log Analytics, KQL (Kusto Query Language), and Azure monitoring. Provide clear, actionable explanations."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1000,
            temperature=0.7
        )

        explanation = response.choices[0].message.content

        return jsonify({
            "success": True,
            "explanation": explanation
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# KQL example queries for quick access
KQL_EXAMPLES = {
    "requests": {
        "name": "Application Requests",
        "queries": [
            {
                "name": "Recent Requests",
                "query": "requests\n| where timestamp > ago(1h)\n| project timestamp, name, resultCode, duration, client_City\n| order by timestamp desc\n| take 100"
            },
            {
                "name": "Failed Requests",
                "query": "requests\n| where timestamp > ago(24h)\n| where success == false\n| summarize count() by name, resultCode\n| order by count_ desc"
            },
            {
                "name": "Request Duration Stats",
                "query": "requests\n| where timestamp > ago(1h)\n| summarize avg(duration), percentile(duration, 95), max(duration) by bin(timestamp, 5m)\n| order by timestamp desc"
            }
        ]
    },
    "exceptions": {
        "name": "Exceptions",
        "queries": [
            {
                "name": "Recent Exceptions",
                "query": "exceptions\n| where timestamp > ago(24h)\n| project timestamp, type, outerMessage, innermostMessage\n| order by timestamp desc\n| take 50"
            },
            {
                "name": "Exception Summary",
                "query": "exceptions\n| where timestamp > ago(7d)\n| summarize count() by type\n| order by count_ desc"
            }
        ]
    },
    "traces": {
        "name": "Traces",
        "queries": [
            {
                "name": "Recent Traces",
                "query": "traces\n| where timestamp > ago(1h)\n| project timestamp, severityLevel, message\n| order by timestamp desc\n| take 100"
            },
            {
                "name": "Error Traces",
                "query": "traces\n| where timestamp > ago(24h)\n| where severityLevel >= 3\n| project timestamp, severityLevel, message\n| order by timestamp desc"
            }
        ]
    },
    "performance": {
        "name": "Performance",
        "queries": [
            {
                "name": "Page Load Times",
                "query": "pageViews\n| where timestamp > ago(24h)\n| summarize avg(duration) by name\n| order by avg_duration desc"
            },
            {
                "name": "Slow Dependencies",
                "query": "dependencies\n| where timestamp > ago(1h)\n| where duration > 1000\n| project timestamp, name, target, duration, success\n| order by duration desc\n| take 50"
            }
        ]
    },
    "custom": {
        "name": "Custom Queries",
        "queries": [
            {
                "name": "Heartbeat Check",
                "query": "Heartbeat\n| where TimeGenerated > ago(1h)\n| summarize count() by Computer\n| order by count_ desc"
            },
            {
                "name": "Azure Activity",
                "query": "AzureActivity\n| where TimeGenerated > ago(24h)\n| summarize count() by OperationName, ActivityStatus\n| order by count_ desc\n| take 20"
            }
        ]
    }
}


@app.route("/api/examples")
def get_examples():
    """Return KQL example queries."""
    return jsonify(KQL_EXAMPLES)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
