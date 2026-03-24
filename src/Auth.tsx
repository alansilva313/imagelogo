import { useState } from 'react';
import { supabase } from './supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, ArrowRight, Sparkles, Loader2, AlertCircle } from 'lucide-react';

interface AuthProps {
  onSuccess: () => void;
}

export function Auth({ onSuccess }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error } = await supabase!.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        onSuccess(); // Call onSuccess only if login is successful
      } else {
        const { data, error } = await supabase!.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });
        if (error) throw error;
        
        // Se o email confirm estiver desativado no Supabase, 'data.session' existirá.
        if (data.session) {
           onSuccess();
           return;
        } else {
           // Fallback caso ainda precise de confirmação manual do dash mas não queremos alertar "verifique e-mail" agressivo
           // Vamos tentar logar logo em seguida caso o usuário queira "cadastra e depois loga"
           setIsLogin(true);
           setError("Cadastro realizado! Agora você pode entrar.");
           return;
        }
      }
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro na autenticação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <motion.div 
        className="auth-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="auth-header">
           <div className="auth-logo">
             <div className="auth-logo-icon">
               <Sparkles size={20} color="#fff" />
             </div>
             <span>Logo<span style={{ color: 'var(--primary)' }}>Image</span></span>
           </div>
           <h1 className="auth-title">{isLogin ? 'Bem-vindo de volta' : 'Criar sua conta'}</h1>
           <p className="auth-subtitle">
             {isLogin ? 'Acesse suas ferramentas de edição premium.' : 'Comece a processar suas imagens em segundos.'}
           </p>
        </div>

        <form onSubmit={handleAuth} className="auth-form">
          <AnimatePresence mode="wait">
            {!isLogin && (
              <motion.div 
                key="name"
                className="input-group"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden' }}
              >
                <label>Nome Completo</label>
                <div className="input-wrapper">
                  <User size={18} className="input-icon" />
                  <input 
                    type="text" 
                    placeholder="Seu nome" 
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    required={!isLogin}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="input-group">
            <label>E-mail</label>
            <div className="input-wrapper">
              <Mail size={18} className="input-icon" />
              <input 
                type="email" 
                placeholder="seu@email.com" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                required 
              />
            </div>
          </div>

          <div className="input-group">
            <label>Senha</label>
            <div className="input-wrapper">
              <Lock size={18} className="input-icon" />
              <input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                required 
              />
            </div>
          </div>

          {error && (
            <motion.div 
              className="auth-error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <AlertCircle size={14} />
              <span>{error}</span>
            </motion.div>
          )}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? (
              <Loader2 className="spinner" size={18} />
            ) : (
              <>
                <span>{isLogin ? 'Entrar Agora' : 'Finalizar Cadastro'}</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            {isLogin ? 'Não tem uma conta?' : 'Já possui uma conta?'}
            <button onClick={() => setIsLogin(!isLogin)} className="auth-switch">
              {isLogin ? 'Cadastre-se' : 'Faça login'}
            </button>
          </p>
        </div>
      </motion.div>

      <style>{`
        .auth-container {
          position: fixed;
          inset: 0;
          background: #06080f;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
          background-image: 
            radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.05) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(96, 165, 250, 0.05) 0%, transparent 40%);
        }
        .auth-card {
          width: 100%;
          max-width: 420px;
          background: rgba(14, 18, 28, 0.8);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
        }
        .auth-header {
          text-align: center;
          margin-bottom: 32px;
        }
        .auth-logo {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 1.25rem;
          color: #fff;
          margin-bottom: 24px;
        }
        .auth-logo-icon {
          width: 38px;
          height: 38px;
          background: linear-gradient(135deg, #3b82f6, #60a5fa);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        .auth-title {
          font-family: 'Poppins', sans-serif;
          font-size: 1.5rem;
          color: #fff;
          margin-bottom: 8px;
          letter-spacing: -0.02em;
        }
        .auth-subtitle {
          font-size: 0.875rem;
          color: #94a3b8;
          line-height: 1.5;
        }
        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .input-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .input-group label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding-left: 4px;
        }
        .input-wrapper {
          position: relative;
        }
        .input-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #475569;
          transition: color 0.2s;
        }
        .input-wrapper input {
          width: 100%;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 12px 14px 12px 42px;
          color: #fff;
          font-size: 0.9375rem;
          transition: all 0.2s;
        }
        .input-wrapper input:focus {
          outline: none;
          background: rgba(59, 130, 246, 0.04);
          border-color: rgba(59, 130, 246, 0.4);
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
        }
        .input-wrapper input:focus + .input-icon {
          color: #3b82f6;
        }
        .auth-error {
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 12px;
          color: #ef4444;
          font-size: 0.8125rem;
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }
        .auth-submit {
          margin-top: 10px;
          padding: 14px;
          background: #3b82f6;
          color: #fff;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.9375rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 10px 20px -5px rgba(59, 130, 246, 0.3);
        }
        .auth-submit:hover:not(:disabled) {
          background: #2563eb;
          transform: translateY(-1px);
          box-shadow: 0 12px 24px -5px rgba(59, 130, 246, 0.4);
        }
        .auth-submit:active:not(:disabled) {
          transform: translateY(0);
        }
        .auth-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .auth-footer {
          margin-top: 24px;
          text-align: center;
        }
        .auth-footer p {
          font-size: 0.875rem;
          color: #64748b;
        }
        .auth-switch {
          background: none;
          border: none;
          color: #3b82f6;
          font-weight: 700;
          margin-left: 6px;
          cursor: pointer;
          padding: 0;
        }
        .auth-switch:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
