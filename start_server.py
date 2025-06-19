#!/usr/bin/env python3
"""
Startup script for TradingView Strategy Optimizer Bayesian Optimization Server
"""

import subprocess
import sys
import os

def check_dependencies():
    """Check if required dependencies are installed"""
    try:
        import flask
        import flask_cors
        import bayes_opt
        import numpy
        print("✓ All dependencies are installed")
        return True
    except ImportError as e:
        print(f"✗ Missing dependency: {e}")
        print("Please install dependencies with: pip install -r requirements.txt")
        print("On Windows, you may need to use: py -m pip install -r requirements.txt")
        return False

def main():
    """Main startup function"""
    print("TradingView Strategy Optimizer - Bayesian Optimization Server")
    print("=" * 60)
    
    # Check if we're in the correct directory
    if not os.path.exists('opt_server.py'):
        print("✗ opt_server.py not found. Please run this script from the project root directory.")
        sys.exit(1)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    print("\nStarting Bayesian Optimization Server...")
    print("Server will be available at: http://127.0.0.1:5000")
    print("Health check endpoint: http://127.0.0.1:5000/health")
    print("\nPress Ctrl+C to stop the server")
    print("-" * 60)
    
    # Start the server
    try:
        from opt_server import app
        app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
    except KeyboardInterrupt:
        print("\n\nServer stopped by user")
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main() 