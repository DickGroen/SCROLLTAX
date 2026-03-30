export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const hours = body.hours || 0;

    if (!env.OPENAI_API_KEY) {
      return new Response("Missing OPENAI_API_KEY", {
        status: 500,
        headers: { "Content-Type": "text/plain" }
      });
    }

    const prompt = `
User scrolled for: ${hours} hours

Act as a direct, slightly confrontational coach.

1. Calculate money lost (€15/hour)
2. Say what they could have done
3. Give a short reality check
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify(data, null, 2), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const text =
      data.output?.[0]?.content?.[0]?.text ||
      JSON.stringify(data, null, 2);

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  } catch (error) {
    return new Response(`Function error: ${error.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
}
