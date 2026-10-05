let nextCall = 0;
const randomUUID = () => "plums-tool-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + (++nextCall);
export const modelProtocols = [
    "OpenAI Chat Completions",
    "OpenAI Responses",
    "Anthropic Messages",
    "Gemini",
];
function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error();
    return value;
}
function string(value) {
    if (typeof value !== "string")
        throw Error();
    return value;
}
function nonempty(value) {
    const result = string(value);
    if (!result)
        throw Error();
    return result;
}
function array(value) {
    if (!Array.isArray(value))
        throw Error();
    return value;
}
function call(value) {
    const c = object(value), f = object(c.function);
    if (c.type !== "function")
        throw Error();
    return {
        id: nonempty(c.id),
        type: "function",
        function: {
            name: nonempty(f.name),
            arguments: string(f.arguments),
        },
    };
}
function messages(value) {
    const result = array(value).map((value) => {
        const m = object(value);
        if (!["system", "developer", "user", "assistant", "tool"].includes(string(m.role)))
            throw Error();
        const content = m.content === null ? null : string(m.content);
        if (m.role !== "assistant" && content === null)
            throw Error();
        return {
            role: m.role,
            content,
            ...(m.role === "tool" ? { tool_call_id: nonempty(m.tool_call_id) } : {}),
            ...(m.role === "assistant" && m.tool_calls !== undefined
                ? { tool_calls: array(m.tool_calls).map(call) }
                : {}),
            ...(m.role === "assistant" && typeof m.reasoning_content === "string"
                ? { reasoning_content: m.reasoning_content }
                : {}),
            ...(m.role === "assistant" && m._plumsModel !== undefined
                ? { _plumsModel: m._plumsModel }
                : {}),
        };
    });
    if (!result.length)
        throw Error();
    return result;
}
function tools(value) {
    if (value === undefined)
        return [];
    return array(value).map((value) => {
        const t = object(value), f = object(t.function);
        if (t.type !== "function")
            throw Error();
        return {
            name: nonempty(f.name),
            parameters: object(f.parameters),
            ...(typeof f.description === "string"
                ? { description: f.description }
                : {}),
        };
    });
}
function native(m, protocol, binding) {
    const state = m._plumsModel;
    if (!state || typeof state !== "object" || Array.isArray(state))
        return undefined;
    if (state.protocol !== protocol || state.binding !== binding)
        return undefined;
    return array(state.items);
}
function append(turns, role, parts, field) {
    if (!parts.length)
        return;
    const last = turns.at(-1);
    if (last?.role === role)
        array(last[field]).push(...parts);
    else
        turns.push({ role, [field]: parts });
}
function inputObject(raw) {
    return object(JSON.parse(raw));
}
/** Translate text and function tools only. No provider names or model catalog are required. */
export function modelRequest(protocol, model, input, binding) {
    const request = object(input), history = messages(request.messages), functions = tools(request.tools);
    const system = history
        .filter((m) => m.role === "system" || m.role === "developer")
        .map((m) => m.content)
        .join("\n\n");
    if (protocol === "OpenAI Chat Completions")
        return {
            model,
            messages: history.map(({ _plumsModel: _state, ...m }) => m),
            ...(functions.length
                ? { tools: functions.map((f) => ({ type: "function", function: f })) }
                : {}),
        };
    if (protocol === "OpenAI Responses") {
        const items = [];
        for (const m of history) {
            const replay = native(m, protocol, binding);
            if (replay) {
                items.push(...replay);
                continue;
            }
            if (m.role === "tool")
                items.push({
                    type: "function_call_output",
                    call_id: m.tool_call_id,
                    output: m.content,
                });
            else {
                if (m.content)
                    items.push({ role: m.role, content: m.content });
                for (const c of m.tool_calls ?? [])
                    items.push({
                        type: "function_call",
                        call_id: c.id,
                        name: c.function.name,
                        arguments: c.function.arguments,
                    });
            }
        }
        return {
            model,
            input: items,
            store: false,
            include: ["reasoning.encrypted_content"],
            ...(functions.length
                ? {
                    tools: functions.map((f) => ({
                        type: "function",
                        ...f,
                        strict: false,
                    })),
                }
                : {}),
        };
    }
    const turns = [];
    const names = new Map();
    for (const m of history) {
        if (m.role === "system" || m.role === "developer")
            continue;
        const replay = native(m, protocol, binding);
        for (const [index, c] of (m.tool_calls ?? []).entries()) {
            const nativeCall = replay?.filter((p) => object(p).functionCall !== undefined)[index];
            const nativeId = nativeCall
                ? object(object(nativeCall).functionCall).id
                : undefined;
            names.set(c.id, {
                name: c.function.name,
                ...(typeof nativeId === "string" ? { nativeId } : {}),
            });
        }
        if (protocol === "Anthropic Messages") {
            const parts = replay ? [...replay] : [];
            if (!replay) {
                if (m.role === "tool")
                    parts.push({
                        type: "tool_result",
                        tool_use_id: m.tool_call_id,
                        content: m.content,
                    });
                else {
                    if (m.content)
                        parts.push({ type: "text", text: m.content });
                    for (const c of m.tool_calls ?? [])
                        parts.push({
                            type: "tool_use",
                            id: c.id,
                            name: c.function.name,
                            input: inputObject(c.function.arguments),
                        });
                }
            }
            append(turns, m.role === "assistant" ? "assistant" : "user", parts, "content");
        }
        else {
            const parts = replay ? [...replay] : [];
            if (!replay) {
                if (m.role === "tool") {
                    const called = names.get(m.tool_call_id);
                    if (!called)
                        throw Error();
                    let output;
                    try {
                        output = JSON.parse(m.content);
                    }
                    catch {
                        output = m.content;
                    }
                    parts.push({
                        functionResponse: {
                            name: called.name,
                            ...(called.nativeId ? { id: called.nativeId } : {}),
                            response: { result: output },
                        },
                    });
                }
                else {
                    if (m.content)
                        parts.push({ text: m.content });
                    for (const c of m.tool_calls ?? [])
                        parts.push({
                            functionCall: {
                                name: c.function.name,
                                args: inputObject(c.function.arguments),
                            },
                        });
                }
            }
            append(turns, m.role === "assistant" ? "model" : "user", parts, "parts");
        }
    }
    if (protocol === "Anthropic Messages")
        return {
            model,
            max_tokens: 4096,
            ...(system ? { system } : {}),
            messages: turns,
            ...(functions.length
                ? {
                    tools: functions.map(({ parameters, ...f }) => ({
                        ...f,
                        input_schema: parameters,
                    })),
                }
                : {}),
        };
    return {
        contents: turns,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(functions.length
            ? {
                tools: [
                    {
                        functionDeclarations: functions.map(({ parameters, ...f }) => ({
                            ...f,
                            parametersJsonSchema: parameters,
                        })),
                    },
                ],
            }
            : {}),
    };
}
/** Keep native continuation items with their binding so protocol/model changes cannot replay them. */
export function modelResponse(protocol, raw, binding, allowTools = true) {
    const response = object(raw), calls = [], texts = [];
    let items;
    let reasoning;
    if (protocol === "OpenAI Chat Completions") {
        const first = object(array(response.choices)[0]), m = object(first.message);
        if (m.role !== "assistant")
            throw Error();
        if (m.content !== null && m.content !== undefined)
            texts.push(string(m.content));
        if (typeof m.refusal === "string")
            texts.push(m.refusal);
        if (m.tool_calls !== undefined)
            calls.push(...array(m.tool_calls).map(call));
        if (typeof m.reasoning_content === "string")
            reasoning = m.reasoning_content;
    }
    else if (protocol === "OpenAI Responses") {
        if (response.status !== undefined && response.status !== "completed")
            throw Error();
        items = array(response.output);
        for (const value of items) {
            const item = object(value);
            if (item.type === "message")
                for (const value of array(item.content)) {
                    const part = object(value);
                    if (part.type === "output_text")
                        texts.push(string(part.text));
                    else if (part.type === "refusal")
                        texts.push(string(part.refusal));
                    else
                        throw Error();
                }
            else if (item.type === "function_call")
                calls.push({
                    id: nonempty(item.call_id),
                    type: "function",
                    function: {
                        name: nonempty(item.name),
                        arguments: string(item.arguments),
                    },
                });
            else if (item.type !== "reasoning")
                throw Error();
        }
    }
    else if (protocol === "Anthropic Messages") {
        items = array(response.content);
        for (const value of items) {
            const part = object(value);
            if (part.type === "text")
                texts.push(string(part.text));
            else if (part.type === "tool_use")
                calls.push({
                    id: nonempty(part.id),
                    type: "function",
                    function: {
                        name: nonempty(part.name),
                        arguments: JSON.stringify(object(part.input)),
                    },
                });
            else if (part.type !== "thinking" && part.type !== "redacted_thinking")
                throw Error();
        }
    }
    else {
        const candidate = object(array(response.candidates)[0]);
        items = array(object(candidate.content).parts);
        for (const value of items) {
            const part = object(value);
            if (typeof part.text === "string") {
                if (part.thought !== true)
                    texts.push(part.text);
            }
            else if (part.functionCall !== undefined) {
                const f = object(part.functionCall);
                calls.push({
                    id: typeof f.id === "string" && f.id ? f.id : randomUUID(),
                    type: "function",
                    function: {
                        name: nonempty(f.name),
                        arguments: JSON.stringify(object(f.args ?? {})),
                    },
                });
            }
            else
                throw Error();
        }
    }
    if ((!texts.length && !calls.length) || (calls.length && !allowTools))
        throw Error();
    const ids = new Set(calls.map((c) => c.id));
    if (ids.size !== calls.length)
        throw Error();
    return {
        choices: [
            {
                message: {
                    role: "assistant",
                    content: texts.join("") || null,
                    ...(calls.length
                        ? { tool_calls: calls }
                        : {}),
                    ...(reasoning === undefined ? {} : { reasoning_content: reasoning }),
                    ...(items ? { _plumsModel: { protocol, binding, items } } : {}),
                },
            },
        ],
    };
}
export function modelHeaders(protocol, key) {
    if (protocol === "Anthropic Messages")
        return { "x-api-key": key, "anthropic-version": "2023-06-01" };
    if (protocol === "Gemini")
        return { "x-goog-api-key": key };
    return { Authorization: "Bearer " + key };
}
