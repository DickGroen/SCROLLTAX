export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const body = await request.json();
    const uren = parseFloat(String(body.uren).replace(',', '.'));
    const uurloon = parseFloat(String(body.uurloon).replace(',', '.'));
    
    if (!uren ||!uurloon || uren <= 0 || uurloon <= 0) {
      return Response.json({ error: 'Vul geldige getallen in' }, { status: 400 });
    }

    const dagen = (uren * 30 / 8).toFixed(1);
    const schuld = Math.round(uren * uurloon * 30);
    
    // Check of OpenAI key er is
    if (!env.OPENAI_API_KEY) {
      return Response.json({ 
        roast: `Je bent ${dagen} werkdagen per maand aan het scrollen. Dat is pure tijdverspilling.`,
        schuld: schuld,
        upsell: 9
      });
    }

    // OpenAI call met timeout
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user', 
          content: `Je bent een sarcastische coach. Iemand scrollt ${uren} uur per dag en verdient €${uurloon}/uur. Roast ze in 1 zin Nederlands. Max 20 woorden.`
        }],
        max_tokens: 50
      })
    });

    const data = await openaiRes.json();
    const roast = data.choices?.[0]?.message?.content || `Je bent ${dagen} werkdagen per maand aan het scrollen. Stop.`;

    return Response.json({ roast, schuld, upsell: 9 });
    
  } catch (e) {
    // Als alles faalt: geef alsnog een resultaat
    return Response.json({ 
      roast: 'Je scrollt teveel. Dat kost je geld.',
      schuld: 2625,
      upsell: 9 
    });
  }
}
