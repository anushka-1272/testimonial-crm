const WATI_BASE_URL = process.env.WATI_BASE_URL;
const WATI_API_KEY = process.env.WATI_API_KEY;

export type WatiTemplateParameter = { name: string; value: string };

export type WatiSendResult =
  | { success: true; data: unknown }
  | { success: false; error: unknown };

export async function sendWatiMessage(
  phone: string,
  template_name: string,
  parameters: WatiTemplateParameter[],
): Promise<WatiSendResult> {
  if (!WATI_BASE_URL || !WATI_API_KEY) {
    console.error("WATI credentials not configured");
    return { success: false, error: "Not configured" };
  }

  const digits = phone.replace(/\D/g, "");
  const formattedPhone = digits.startsWith("91") ? digits : `91${digits}`;

  try {
    const response = await fetch(
      `${WATI_BASE_URL}/api/v1/sendTemplateMessage?whatsappNumber=${formattedPhone}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WATI_API_KEY}`,
        },
        body: JSON.stringify({
          template_name,
          broadcast_name: template_name,
          parameters,
        }),
      },
    );

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error("WATI error:", data);
      return { success: false, error: data };
    }
    console.log("WATI success:", template_name, formattedPhone);
    return { success: true, data };
  } catch (err) {
    console.error("WATI fetch error:", err);
    return { success: false, error: err };
  }
}
