/* ==============================================================
   SIGN IN WITH APPLE

   Native only, and additive: the email/password form is untouched
   and is still the whole of the sign-in screen in a browser. The
   button below it is drawn by renderAppleButton() and only when
   the plugin exists, the same way every other native piece in this
   app hides itself. See AppleAuth.swift.

   ⚠️ IT IS ALSO A STORE REQUIREMENT ONCE ANY OTHER THIRD-PARTY
   LOGIN EXISTS (Guideline 4.8). There is none today, so this is
   free choice — but adding Google later without this would be a
   rejection.

   ⚠️ SUPABASE NEEDS THE APPLE PROVIDER TURNED ON, and until it is
   this returns "Unsupported provider". That is a dashboard
   setting, not code: Authentication → Providers → Apple, with the
   Services ID and the key from the developer portal. The button
   still draws — the failure is a message on the screen, which is
   the right way round for something a person can fix.
   ============================================================== */

function appleAuthPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.AppleAuth) || null;
}
function appleSignInAvailable(){ return !!appleAuthPlugin(); }

/* Called from showAuth(). The button is markup that is always there
   and hidden by default, so nothing has to be built at the moment
   somebody is looking at the screen. */
function renderAppleButton(){
  const row=$('authApple');
  if(!row) return;
  row.style.display=appleSignInAvailable()?'':'none';
}

async function signInWithApple(){
  const p=appleAuthPlugin();
  if(!p) return;
  const btn=$('authAppleBtn');
  setAuthError('');
  if(btn) btn.disabled=true;
  try{
    const r=await p.signIn();
    /* Dismissing the system sheet is a decision, not a failure — no
       message, nothing to clear up. */
    if(!r||r.cancelled){ return; }
    if(!r.idToken){ setAuthError('Apple did not return a sign-in token.'); return; }

    /* ⚠️ The RAW nonce goes here. Apple was given its SHA-256; Supabase
       hashes this one itself and compares. See AppleAuth.swift. */
    const{data,error}=await sb.auth.signInWithIdToken({
      provider:'apple',
      token:r.idToken,
      nonce:r.nonce||undefined,
    });
    if(error){ setAuthError(authErrorText(error)); return; }

    /* ⚠️ THE NAME COMES BACK ONCE IN THE LIFETIME OF THE ACCOUNT and
       then never again, so it has to be kept the moment it arrives.
       Written to user_metadata because that is where profileSeed()
       looks when it creates the Users row — see js/me.js. */
    if(r.name&&data&&data.user){
      try{ await sb.auth.updateUser({data:{full_name:r.name}}); }catch(e){}
      /* And directly onto the row, for the ordinary case where the
         auth state change already created it a moment ago with the
         email's local part standing in for a name. */
      try{
        await sb.from('Users').update({display_name:r.name})
          .eq('id',data.user.id).or('display_name.is.null,display_name.eq.');
      }catch(e){}
    }
    /* Nothing else to do: onAuthStateChange in auth.js takes it from
       here exactly as it does for a password sign-in. */
  }catch(e){
    console.warn('[apple] sign-in failed',e);
    setAuthError('Could not sign in with Apple. Please try again.');
  }finally{
    if(btn) btn.disabled=false;
  }
}
