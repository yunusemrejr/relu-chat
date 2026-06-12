# Contributing & Roadmap

## Contributing

We welcome contributions! Areas of interest:

### High Priority
- Add new chatbots (Cryptography Chat, Quantum Computing Chat, etc.)
- Expand the Game Theory Knowledge Base with more concepts
- Add `related` cross-references between existing concepts
- Improve mobile experience of the chat UI
- Performance optimizations for model loading

### How to Contribute
1. Fork the repo
2. Follow the existing code style (no frameworks, vanilla JS, clean modular structure)
3. Add new concepts to `knowledge-base.js` following the established pattern (include `related` field)
4. Test thoroughly in multiple browsers
5. Submit PR with clear description

**Note**: Do not introduce external heavy dependencies. Keep it lightweight and auditable. All thresholds should go in `config.js`.

## Roadmap

- [ ] Additional specialized chatbots
- [ ] Improved model quantization / smaller embeddings
- [ ] Offline PWA support
- [ ] Export conversation as PDF/LaTeX
- [ ] Better suggestion engine based on conversation history
- [ ] Multi-language support (starting with Turkish)
- [ ] Interactive payoff matrix visualizer
- [ ] Integration with local LLM fallback (via WebLLM) for advanced reasoning

## License

MIT — see root LICENSE (or implied by README).

**Questions?** Open an issue on GitHub or try asking the Game Theory Chat itself.
