import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { useSession } from '../../app/providers/SessionProvider';
import { homePath } from '../../shared/domain/permissions';
import { Card, Button, Field, Notice } from '../../shared/ui/primitives';
export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [account, setAccount] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="session-page">
      <div className="session-brand">
        <Sprout size={32} /> bloom.
      </div>
      <Card>
        <div className="session-intro">
          <h1>Đăng nhập Bloom Bakery</h1>
          <p>Sử dụng tài khoản được quản trị viên cấp.</p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const user = await login(account, password);
              navigate(homePath(user.role), { replace: true });
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Không thể đăng nhập.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Tài khoản hoặc email" required>
            <input
              autoComplete="username"
              required
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </Field>
          <Field label="Mật khẩu" required>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
