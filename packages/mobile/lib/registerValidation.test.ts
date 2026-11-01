import { firstInvalidField, isAtLeast18, validateRegister, type RegisterFields } from './registerValidation';

const NOW = Date.UTC(2026, 9, 28);
const valid: RegisterFields = {
  username: 'alice',
  email: 'a@b.co',
  password: 'password123',
  confirmPassword: 'password123',
  dob: new Date(Date.UTC(1995, 0, 1)),
  tosAccepted: true,
};

describe('validateRegister', () => {
  it('accepts a complete form', () => {
    expect(validateRegister(valid, NOW)).toEqual({});
  });

  it('reports every missing field at once', () => {
    const errors = validateRegister(
      { username: '', email: '', password: '', confirmPassword: '', dob: null, tosAccepted: false },
      NOW,
    );
    expect(Object.keys(errors).sort()).toEqual(['dob', 'email', 'password', 'tosAccepted', 'username']);
  });

  it('flags a short password and a mismatch separately', () => {
    const errors = validateRegister({ ...valid, password: 'short', confirmPassword: 'other' }, NOW);
    expect(errors.password).toBe('Password must be at least 8 characters');
    expect(errors.confirmPassword).toBe('Passwords do not match');
  });

  it('rejects under 18 and accepts exactly 18 today', () => {
    expect(isAtLeast18(new Date(Date.UTC(2008, 9, 29)), NOW)).toBe(false);
    expect(isAtLeast18(new Date(Date.UTC(2008, 9, 28)), NOW)).toBe(true);
    expect(validateRegister({ ...valid, dob: new Date(Date.UTC(2015, 0, 1)) }, NOW).dob).toBe(
      'You must be at least 18 to use Festie',
    );
  });
});

describe('firstInvalidField', () => {
  it('returns the earliest field in screen order', () => {
    expect(firstInvalidField({ tosAccepted: 'x', dob: 'y', email: 'z' })).toBe('email');
    expect(firstInvalidField({})).toBeUndefined();
  });
});

describe('isAtLeast18 in a non-UTC zone', () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('uses local calendar parts under Asia/Tokyo', () => {
    process.env.TZ = 'Asia/Tokyo';
    const dob = new Date(2008, 9, 31, 8, 0); // local 08:00 on the 18th birthday
    expect(isAtLeast18(dob, new Date(2026, 9, 31, 8, 0).getTime())).toBe(true);
    expect(isAtLeast18(dob, new Date(2026, 9, 30, 23, 0).getTime())).toBe(false);
  });
});
