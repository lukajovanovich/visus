// Aplikacija se preselila sa /app/ na početnu stranu. Čuva ?code=… (Supabase prijava) i #ruta.
location.replace('/' + location.search + location.hash);
