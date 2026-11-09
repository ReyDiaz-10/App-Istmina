import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const { payload } = await req.json();

  // 1. Verificamos que el evento sea de transacción aprobada
  if (payload.event === 'TRANSACTION_APPROVED') {
    const businessId = payload.data.reference; // El ID del negocio que enviamos al crear el pago
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Usamos la Service Role para saltar el RLS
    );

    // 2. Actualizamos la suscripción a ACTIVA por 30 días
    const { error } = await supabaseClient
      .from('subscriptions')
      .upsert({ 
        business_id: businessId, 
        is_active: true, 
        start_date: new Date().toISOString(), 
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() 
      }, { onConflict: 'business_id' });

    if (error) return new Response("Error DB", { status: 500 });
  }

  return new Response("OK", { status: 200 });
})
