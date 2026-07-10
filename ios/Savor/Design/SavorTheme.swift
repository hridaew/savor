import SwiftUI

enum SavorTheme {
    static let backgroundTop = Color(red: 0.97, green: 0.98, blue: 0.99)
    static let backgroundBottom = Color(red: 0.92, green: 0.93, blue: 0.96)
    static let accent = Color(red: 0.0, green: 0.48, blue: 1.0)
    static let cyan = Color(red: 0.20, green: 0.68, blue: 0.90)
    static let warm = Color(red: 1.0, green: 0.77, blue: 0.55)
    static let label = Color(red: 0.11, green: 0.11, blue: 0.12)

    static let cardRadius: CGFloat = 26
    static let tileRadius: CGFloat = 20
    static let buttonRadius: CGFloat = 16
    static let sheetRadius: CGFloat = 30

    static let spring = Animation.spring(response: 0.38, dampingFraction: 0.86)
    static let quick = Animation.easeOut(duration: 0.22)
}

struct SavorBackdrop: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [SavorTheme.backgroundTop, SavorTheme.backgroundBottom],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: [SavorTheme.cyan.opacity(0.18), .clear],
                center: .topLeading,
                startRadius: 20,
                endRadius: 420
            )
            RadialGradient(
                colors: [SavorTheme.warm.opacity(0.16), .clear],
                center: .bottomTrailing,
                startRadius: 40,
                endRadius: 480
            )
        }
        .ignoresSafeArea()
    }
}

struct GlassCard<Content: View>: View {
    var padding: CGFloat = 18
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .savorGlass(cornerRadius: SavorTheme.cardRadius)
    }
}

struct GlassControlButton: View {
    let systemImage: String
    var label: String? = nil
    var tint: Color? = nil
    var isOn: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.body.weight(.semibold))
                if let label {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                }
            }
            .foregroundStyle(tint ?? (isOn ? SavorTheme.accent : .primary))
            .padding(.horizontal, label == nil ? 12 : 14)
            .padding(.vertical, 12)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .savorGlass(cornerRadius: 999, interactive: true, tint: isOn ? SavorTheme.accent.opacity(0.25) : nil)
        .accessibilityLabel(label ?? systemImage)
    }
}

extension View {
    @ViewBuilder
    func savorGlass(
        cornerRadius: CGFloat = 16,
        interactive: Bool = false,
        tint: Color? = nil
    ) -> some View {
        if #available(iOS 26.0, *) {
            let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            if let tint {
                self.glassEffect(
                    interactive ? .regular.tint(tint).interactive() : .regular.tint(tint),
                    in: shape
                )
            } else if interactive {
                self.glassEffect(.regular.interactive(), in: shape)
            } else {
                self.glassEffect(.regular, in: shape)
            }
        } else {
            self
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(.white.opacity(0.45), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.08), radius: 16, y: 8)
        }
    }

    @ViewBuilder
    func savorGlassButton() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glass)
        } else {
            self.buttonStyle(.bordered)
        }
    }

    @ViewBuilder
    func savorProminentGlassButton() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glassProminent)
        } else {
            self.buttonStyle(.borderedProminent)
        }
    }
}
