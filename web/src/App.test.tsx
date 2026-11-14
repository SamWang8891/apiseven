import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import App from './App';

afterEach(() => {
  window.location.hash = '';
});

it('renders the app name', () => {
  render(<App />);
  expect(screen.getByText('apiseven')).toBeInTheDocument();
});

it('renders the UI kit gallery at #/__kit, every component in every state', async () => {
  window.location.hash = '#/__kit';
  render(<App />);
  expect(await screen.findByRole('heading', { name: /UI kit/ })).toBeInTheDocument();
  expect(await screen.findByRole('textbox', { name: 'limit-count config' })).toBeInTheDocument();
});
