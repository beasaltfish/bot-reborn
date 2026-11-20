import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BodyDiagram } from './BodyDiagram';

const parts = (kind: 'toy' | 'pet' | 'tarot' | 'voice' | 'dry-run', frames: string[] = []) => {
  const { container } = render(<BodyDiagram kind={kind} frames={frames} label="A body" />);
  return { drawn: [...container.querySelectorAll('[data-part]')].map((n) => n.getAttribute('data-part')), container };
};

describe('BodyDiagram', () => {
  it('draws the parts each body is made of', () => {
    expect(parts('toy').drawn.sort()).toEqual(['battery', 'board', 'chassis', 'motor', 'wheels']);
    expect(parts('pet').drawn.sort()).toEqual(['board', 'screen']);
    expect(parts('tarot').drawn.sort()).toEqual(['board', 'screen', 'wand']);
    expect(parts('voice').drawn.sort()).toEqual(['amp', 'board', 'mic']);
  });

  it('puts the body on the picture: a screen shows the frames the brain has', () => {
    const { container } = parts('pet', ['/preview/pet/320x240/rest-sit/001.jpg']);
    expect(container.querySelector('image')?.getAttribute('href')).toBe('/preview/pet/320x240/rest-sit/001.jpg');
  });

  it('draws the body with no art when there is none, not a broken picture', () => {
    const { container } = parts('pet');
    expect(container.querySelector('image')).toBeNull();
    expect(container.querySelector('[data-part="screen"]')).not.toBeNull();
  });

  it('is one image with a name, not a wall of shapes to a screen reader', () => {
    render(<BodyDiagram kind="toy" frames={[]} label="Toy" />);
    expect(screen.getByRole('img', { name: 'Toy' })).toBeInTheDocument();
  });
});
