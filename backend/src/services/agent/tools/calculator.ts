import type { ToolDefinition } from "../types";

/**
 * Safe expression evaluator for + - * / % ^ parentheses, unary +/-, decimals.
 * Implements a small recursive-descent parser so we never call Function/eval.
 */
function evaluateExpression(expression: string): number {
  let cursor = 0;
  const input = expression.replace(/\s+/g, "");

  if (input.length === 0) {
    throw new Error("Expression is empty.");
  }

  if (!/^[0-9+\-*/%^().]+$/.test(input)) {
    throw new Error("Expression contains unsupported characters.");
  }

  function peek(): string {
    return input[cursor];
  }

  function consume(expected?: string): string {
    const ch = input[cursor];
    if (expected !== undefined && ch !== expected) {
      throw new Error(`Expected '${expected}' at position ${cursor}.`);
    }
    cursor++;
    return ch;
  }

  function parseNumber(): number {
    const start = cursor;
    while (cursor < input.length && /[0-9.]/.test(input[cursor])) {
      cursor++;
    }
    const raw = input.slice(start, cursor);
    if (raw === "" || raw === ".") {
      throw new Error("Invalid number literal.");
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error("Invalid number literal.");
    }
    return value;
  }

  function parsePrimary(): number {
    const ch = peek();
    if (ch === "(") {
      consume("(");
      const value = parseExpression();
      consume(")");
      return value;
    }
    if (ch === "+") {
      consume("+");
      return parseUnary();
    }
    if (ch === "-") {
      consume("-");
      return -parseUnary();
    }
    return parseNumber();
  }

  function parseUnary(): number {
    return parsePrimary();
  }

  function parsePower(): number {
    let base = parseUnary();
    while (peek() === "^") {
      consume("^");
      const exponent = parseUnary();
      base = Math.pow(base, exponent);
    }
    return base;
  }

  function parseFactor(): number {
    let value = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const rhs = parsePower();
      if (op === "*") {
        value *= rhs;
      } else if (op === "/") {
        if (rhs === 0) throw new Error("Division by zero.");
        value /= rhs;
      } else {
        if (rhs === 0) throw new Error("Modulo by zero.");
        value %= rhs;
      }
    }
    return value;
  }

  function parseExpression(): number {
    let value = parseFactor();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const rhs = parseFactor();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  const result = parseExpression();
  if (cursor !== input.length) {
    throw new Error(`Unexpected token at position ${cursor}.`);
  }
  if (!Number.isFinite(result)) {
    throw new Error("Expression did not evaluate to a finite number.");
  }
  return result;
}

export const calculatorTool: ToolDefinition = {
  name: "calculator",
  description:
    "Evaluate an arithmetic expression reliably. ALWAYS call this for non-trivial math: multi-digit multiply/divide, percentages, exponentials (^), chained operations, parentheses, roots (use fractional powers like `x^0.5`). Never guess large products or fractions in prose—invoke this tool.",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "Fully parenthesised expression as a single line, e.g. '347 * (19 + 2) / 3'."
      }
    },
    required: ["expression"]
  },
  handler: async (args) => {
    const expression = String(args?.expression ?? "").trim();
    if (!expression) {
      throw new Error("Missing required 'expression' argument.");
    }
    const value = evaluateExpression(expression);
    return { expression, value };
  }
};
