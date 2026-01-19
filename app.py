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

# Available AI Models configuration
AI_MODELS = {
    "gpt-4": {
        "name": "GPT-4",
        "deployment": "gpt-4",
        "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT"),
        "key": os.getenv("AZURE_OPENAI_KEY")
    },
    "gpt-4.1-nano": {
        "name": "GPT-4.1 Nano",
        "deployment": "gpt-4.1-nano",
        "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT_2"),
        "key": os.getenv("AZURE_OPENAI_KEY_2")
    },
    "gpt-5.2-chat": {
        "name": "GPT-5.2 Chat",
        "deployment": "gpt-5.2-chat",
        "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT_2"),
        "key": os.getenv("AZURE_OPENAI_KEY_2")
    },
    "o4-mini": {
        "name": "O4 Mini",
        "deployment": "o4-mini",
        "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT_2"),
        "key": os.getenv("AZURE_OPENAI_KEY_2")
    }
}

DEFAULT_MODEL = "gpt-4"

def get_openai_client(model_id):
    """Get an OpenAI client for the specified model."""
    model_config = AI_MODELS.get(model_id)
    if not model_config:
        return None, None
    
    endpoint = model_config.get("endpoint")
    key = model_config.get("key")
    deployment = model_config.get("deployment")
    
    if not endpoint or not key:
        return None, None
    
    client = AzureOpenAI(
        azure_endpoint=endpoint,
        api_key=key,
        api_version="2025-01-01-preview"
    )
    return client, deployment


@app.route("/")
def index():
    """Render the main query interface."""
    return render_template("index.html", default_workspace_id=DEFAULT_WORKSPACE_ID)


@app.route("/api/models")
def get_models():
    """Return available AI models."""
    models = [
        {"id": model_id, "name": config["name"]}
        for model_id, config in AI_MODELS.items()
        if config.get("endpoint") and config.get("key")
    ]
    return jsonify({"models": models, "default": DEFAULT_MODEL})


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


@app.route("/api/benchmark/evaluate", methods=["POST"])
def evaluate_explanation():
    """Evaluate an explanation using LLM-as-judge."""
    try:
        data = request.get_json()
        explanation = data.get("explanation", "")
        test_case = data.get("testCase", {})
        target_audience = data.get("targetAudience", "developer")

        # Truncate explanation to prevent huge payloads
        max_explanation_len = 3000
        if len(explanation) > max_explanation_len:
            explanation = explanation[:max_explanation_len] + "... [truncated]"
        
        # Limit result data size
        results = test_case.get('results', {})
        if 'rows' in results and len(results['rows']) > 5:
            results = {**results, 'rows': results['rows'][:5]}
        results_str = json.dumps(results, default=str)[:800]

        # Use GPT-4 as the judge
        openai_client, deployment = get_openai_client("gpt-4")
        
        if not openai_client:
            return jsonify({"error": "Judge model not configured"}), 500

        evaluation_prompt = f"""You are a STRICT and CRITICAL evaluator for Azure Log Analytics explanations.
Your job is to find flaws and differentiate quality. Do NOT give perfect scores unless the explanation is truly exceptional.
Most explanations should score between 2-4, with 5 reserved for exceptional work and 1-2 for poor work.

## Context
- Target Audience: {target_audience}
- KQL Query: {test_case.get('query', 'N/A')[:500]}
- Result Data: {results_str}

## Explanation to Evaluate:
{explanation}

## Scoring Rubric (1-5 scale) - BE CRITICAL:

1. **Faithfulness** (No hallucinations - CRITICAL)
   - 5: ONLY if every single claim is directly supported by the data shown
   - 4: Very accurate with only trivial inferences
   - 3: Mostly accurate, some unsupported but reasonable inferences
   - 2: Contains some claims not supported by data
   - 1: Contains hallucinated metrics, causes, or false claims

2. **Structure** (Organization)
   - 5: Perfect structure with clear headings, logical flow, scannable
   - 4: Well organized with minor improvements possible
   - 3: Has some structure but could be clearer
   - 2: Poorly organized, hard to follow
   - 1: Wall of text, no organization

3. **Clarity** (Understandable to {target_audience})
   - 5: Crystal clear, perfectly matched to audience level
   - 4: Clear with minor jargon issues
   - 3: Understandable but assumes some knowledge
   - 2: Contains unexplained technical terms
   - 1: Confusing, wrong audience level

4. **Analysis Depth** (Insights beyond restating numbers)
   - 5: Provides genuine insights about patterns, anomalies, implications
   - 4: Good analysis with some insights
   - 3: Basic analysis, mostly restates data with some interpretation
   - 2: Minimal analysis, mostly describes what's shown
   - 1: Just restates the numbers with no insight

5. **Context Accuracy** (Azure/Log Analytics knowledge)
   - 5: Demonstrates expert Azure knowledge, correct terminology
   - 4: Solid Azure understanding
   - 3: Basic but correct Azure interpretation
   - 2: Minor misunderstandings of Azure concepts
   - 1: Fundamentally wrong Azure interpretation

6. **Actionability** (Useful next steps)
   - 5: Specific, actionable steps tied directly to the data
   - 4: Good recommendations aligned with findings
   - 3: Generic but relevant recommendations
   - 2: Vague or partially relevant recommendations
   - 1: No recommendations or completely irrelevant ones

7. **Conciseness** (Efficiency of communication)
   - 5: Every sentence adds value, perfect length
   - 4: Mostly efficient with minor redundancy
   - 3: Some filler or missing details
   - 2: Too verbose or missing important info
   - 1: Extremely verbose/repetitive OR missing critical information

BE STRICT. A score of 5 should be rare. Average explanations should get 3s.

Respond ONLY with a JSON object:
{{
    "faithfulness": <score 1-5>,
    "structure": <score 1-5>,
    "clarity": <score 1-5>,
    "analysisDepth": <score 1-5>,
    "contextAccuracy": <score 1-5>,
    "actionability": <score 1-5>,
    "conciseness": <score 1-5>,
    "evaluatorNotes": "<specific critique explaining low scores>"
}}`"""

        response = openai_client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": "You are an expert evaluator. Respond only with valid JSON."},
                {"role": "user", "content": evaluation_prompt}
            ],
            max_tokens=500,
            temperature=0.3
        )

        response_text = response.choices[0].message.content.strip()
        print(f"[BENCHMARK EVAL] Raw response: {response_text[:500]}")
        
        # Parse JSON response
        try:
            # Try to extract JSON from response
            if response_text.startswith('```'):
                response_text = response_text.split('```')[1]
                if response_text.startswith('json'):
                    response_text = response_text[4:]
            scores = json.loads(response_text)
            print(f"[BENCHMARK EVAL] Parsed scores: {scores}")
        except json.JSONDecodeError as e:
            print(f"[BENCHMARK EVAL] JSON parse error: {e}")
            # Fallback to default scores if parsing fails
            scores = {
                "faithfulness": 3,
                "structure": 3,
                "clarity": 3,
                "analysisDepth": 3,
                "contextAccuracy": 3,
                "actionability": 3,
                "conciseness": 3,
                "evaluatorNotes": "Failed to parse evaluation response"
            }

        return jsonify({"scores": scores})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/explain", methods=["POST"])
def explain_results():
    """Generate an AI explanation of query results."""
    try:
        data = request.get_json()
        query = data.get("query", "")
        tables = data.get("tables", [])
        total_rows = data.get("total_rows", 0)
        model_id = data.get("model", DEFAULT_MODEL)

        # Get the appropriate client for the selected model
        openai_client, deployment = get_openai_client(model_id)
        
        if not openai_client:
            return jsonify({"error": f"Model '{model_id}' not configured"}), 500

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

        # O-series models (o4-mini, o1, etc.) don't support system messages or temperature
        if model_id.startswith("o"):
            # Combine system prompt into user message for o-series models
            combined_prompt = f"""You are an expert in Azure Log Analytics, KQL (Kusto Query Language), and Azure monitoring. Provide clear, actionable explanations.

{prompt}"""
            response = openai_client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "user", "content": combined_prompt}
                ],
                max_completion_tokens=1000
            )
        # Use max_completion_tokens for newer chat models (gpt-5.2, etc.)
        elif model_id in ["gpt-5.2-chat"]:
            response = openai_client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "system", "content": "You are an expert in Azure Log Analytics, KQL (Kusto Query Language), and Azure monitoring. Provide clear, actionable explanations."},
                    {"role": "user", "content": prompt}
                ],
                max_completion_tokens=1000
            )
        else:
            response = openai_client.chat.completions.create(
                model=deployment,
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
            "explanation": explanation,
            "model": model_id
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# KQL example queries for quick access
KQL_EXAMPLES = {
    "heartbeat": {
        "name": "Heartbeat & Health",
        "queries": [
            {
                "name": "Agent Heartbeats",
                "query": "Heartbeat\n| where TimeGenerated > ago(1h)\n| summarize LastHeartbeat=max(TimeGenerated) by Computer, OSType\n| order by LastHeartbeat desc"
            },
            {
                "name": "Heartbeat Count by Computer",
                "query": "Heartbeat\n| where TimeGenerated > ago(24h)\n| summarize HeartbeatCount=count() by Computer\n| order by HeartbeatCount desc"
            },
            {
                "name": "Missing Heartbeats",
                "query": "Heartbeat\n| where TimeGenerated > ago(1d)\n| summarize LastHeartbeat=max(TimeGenerated) by Computer\n| where LastHeartbeat < ago(15m)\n| order by LastHeartbeat asc"
            }
        ]
    },
    "azureactivity": {
        "name": "Azure Activity",
        "queries": [
            {
                "name": "Recent Activity",
                "query": "AzureActivity\n| where TimeGenerated > ago(24h)\n| project TimeGenerated, OperationName, ActivityStatus, Caller, ResourceGroup\n| order by TimeGenerated desc\n| take 100"
            },
            {
                "name": "Failed Operations",
                "query": "AzureActivity\n| where TimeGenerated > ago(24h)\n| where ActivityStatus == 'Failed'\n| summarize FailedCount=count() by OperationName, ResourceGroup\n| order by FailedCount desc"
            },
            {
                "name": "Activity by Caller",
                "query": "AzureActivity\n| where TimeGenerated > ago(7d)\n| summarize OperationCount=count() by Caller\n| order by OperationCount desc\n| take 20"
            }
        ]
    },
    "performance": {
        "name": "Performance",
        "queries": [
            {
                "name": "CPU Usage",
                "query": "Perf\n| where TimeGenerated > ago(1h)\n| where ObjectName == 'Processor' and CounterName == '% Processor Time'\n| summarize AvgCPU=avg(CounterValue) by Computer, bin(TimeGenerated, 5m)\n| order by TimeGenerated desc"
            },
            {
                "name": "Memory Usage",
                "query": "Perf\n| where TimeGenerated > ago(1h)\n| where ObjectName == 'Memory' and CounterName == '% Used Memory'\n| summarize AvgMemory=avg(CounterValue) by Computer\n| order by AvgMemory desc"
            },
            {
                "name": "Disk Free Space",
                "query": "Perf\n| where TimeGenerated > ago(1h)\n| where ObjectName == 'LogicalDisk' and CounterName == '% Free Space'\n| summarize AvgFreeSpace=avg(CounterValue) by Computer, InstanceName\n| where AvgFreeSpace < 20\n| order by AvgFreeSpace asc"
            }
        ]
    },
    "security": {
        "name": "Security",
        "queries": [
            {
                "name": "Security Events",
                "query": "SecurityEvent\n| where TimeGenerated > ago(24h)\n| summarize EventCount=count() by EventID, Activity\n| order by EventCount desc\n| take 20"
            },
            {
                "name": "Failed Logons",
                "query": "SecurityEvent\n| where TimeGenerated > ago(24h)\n| where EventID == 4625\n| summarize FailedLogons=count() by TargetAccount, Computer\n| order by FailedLogons desc"
            },
            {
                "name": "Account Lockouts",
                "query": "SecurityEvent\n| where TimeGenerated > ago(7d)\n| where EventID == 4740\n| project TimeGenerated, TargetAccount, Computer\n| order by TimeGenerated desc"
            }
        ]
    },
    "syslog": {
        "name": "Syslog (Linux)",
        "queries": [
            {
                "name": "Recent Syslog",
                "query": "Syslog\n| where TimeGenerated > ago(1h)\n| project TimeGenerated, Computer, Facility, SeverityLevel, SyslogMessage\n| order by TimeGenerated desc\n| take 100"
            },
            {
                "name": "Errors by Facility",
                "query": "Syslog\n| where TimeGenerated > ago(24h)\n| where SeverityLevel in ('err', 'crit', 'alert', 'emerg')\n| summarize ErrorCount=count() by Facility, Computer\n| order by ErrorCount desc"
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
