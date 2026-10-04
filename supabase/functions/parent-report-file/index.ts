import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parentPublicationHandler } from '../_shared/parent-publication.ts';
Deno.serve(parentPublicationHandler('file',{createClient,env:name=>Deno.env.get(name)}));
